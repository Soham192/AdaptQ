import asyncio
import json
import logging
import time

from jugaadflow.agents import get_client, call_llm, MODEL, RateLimitError, LLMError
from jugaadflow.agents.state import AgentState, capture_snapshot
from jugaadflow.pipeline.thresholds import Thresholds
from jugaadflow.pipeline.strategy import Strategy
from jugaadflow.pipeline.queues import Queues
from jugaadflow.metrics.store import Metrics
from jugaadflow.pipeline.decision_engine import LEVEL_NAMES

logger = logging.getLogger("jugaadflow.optimizer")

SYSTEM_PROMPT = """You are a pipeline optimization agent for JugaadFlow, an event processing system with 4 priority tiers and 8 fixed workers.

Your job: tune escalation/de-escalation thresholds and batch parameters to maximize throughput while maintaining zero payment event shedding.

HARD CONSTRAINTS you must never violate:
- payment_shed must always remain 0
- Escalation thresholds must be monotonically increasing: level1 < level2 < level3 for each metric
- De-escalation thresholds must be strictly below their corresponding escalation thresholds
- shed_sample_rate must be in [0.01, 0.5]
- batch_sizes values must be in [5, 200]
- deescalation_cooldown must be in [3.0, 15.0]
- backpressure_threshold must be > backpressure_release

Return ONLY valid JSON with this exact structure:
{
  "changes": {"dotted.key.path": new_value, ...},
  "reasoning": "one paragraph explaining why",
  "confidence": 0.0 to 1.0
}

Only include fields you want to change. If the system is performing well and no changes are needed, return:
{"changes": {}, "reasoning": "System is performing optimally", "confidence": 1.0}"""


def _build_user_prompt(thresholds: Thresholds, metrics: Metrics, queues: Queues) -> str:
    snapshot = capture_snapshot(metrics, queues)
    recent = list(metrics.recent_decisions)[:10]

    return json.dumps({
        "current_thresholds": thresholds.snapshot(),
        "metrics": snapshot.to_dict(),
        "recent_decisions": recent,
        "counters": {
            "processed": dict(metrics.processed_count),
            "shed": dict(metrics.shed_count),
            "deferred": dict(metrics.deferred_count),
            "batched": dict(metrics.batched_count),
        },
        "incoming_rate": metrics.incoming_rate,
        "current_level": LEVEL_NAMES.get(metrics.current_level, "UNKNOWN"),
    }, indent=2, default=str)


def _validate_changes(changes: dict, thresholds: Thresholds) -> str | None:
    """Returns error string if invalid, None if OK."""
    import copy
    test = Thresholds()
    test.apply_changes(thresholds.snapshot())
    test.apply_changes(changes)

    for key, value in changes.items():
        if "shed_sample_rate" in key:
            if not (0.01 <= value <= 0.5):
                return f"{key}={value} outside [0.01, 0.5]"
        if "batch_sizes" in key and isinstance(value, dict):
            for tier, size in value.items():
                if not (5 <= size <= 200):
                    return f"batch_sizes.{tier}={size} outside [5, 200]"

    if key == "deescalation_cooldown" and not (3.0 <= value <= 15.0):
        return f"deescalation_cooldown={value} outside [3.0, 15.0]"

    esc = test.escalation
    for metric in ("t1_latency_ms", "t1_queue", "lower_queue"):
        vals = [getattr(esc[lvl], metric) for lvl in (1, 2, 3)]
        if not (vals[0] < vals[1] < vals[2]):
            return f"escalation.{metric} not monotonic: {vals}"

    for lvl in (1, 2, 3):
        e = test.escalation[lvl]
        d = test.deescalation[lvl]
        if d.t1_latency_ms >= e.t1_latency_ms:
            return f"deescalation.{lvl}.t1_latency_ms ({d.t1_latency_ms}) >= escalation ({e.t1_latency_ms})"
        if d.t1_queue >= e.t1_queue:
            return f"deescalation.{lvl}.t1_queue ({d.t1_queue}) >= escalation ({e.t1_queue})"

    if test.backpressure_threshold <= test.backpressure_release:
        return f"backpressure_threshold ({test.backpressure_threshold}) <= release ({test.backpressure_release})"

    return None


async def _safe_llm_call(client, user_msg: str) -> dict | None:
    try:
        result = await asyncio.to_thread(
            call_llm, client,
            model=MODEL, system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_msg}],
            max_tokens=8192,
        )
        text = result["choices"][0]["message"]["content"]
        return json.loads(text)
    except RateLimitError:
        raise
    except LLMError as e:
        logger.error("LLM call failed: %s", e)
        return None
    except json.JSONDecodeError as e:
        logger.warning("LLM returned invalid JSON: %s", e)
        return None
    except Exception as e:
        logger.error("LLM call failed: %s", e)
        return None


def _log_action(agent_state: AgentState, action: str, summary: str,
                confidence: float | None = None, details: dict | None = None):
    ts = time.strftime("%H:%M:%S", time.localtime())
    entry = {
        "time": ts,
        "agent": "optimizer",
        "action": action,
        "summary": summary,
        "confidence": confidence,
        "verdict": None,
        "details": details or {},
    }
    agent_state.recent_actions.appendleft(entry)


async def optimizer_loop(
    thresholds: Thresholds,
    strategy: Strategy,
    queues: Queues,
    metrics: Metrics,
    agent_state: AgentState,
    interval: float = 30.0,
):
    client = get_client()
    if not client:
        logger.warning("No Anthropic client — optimizer disabled")
        return

    logger.info("Optimizer agent starting (interval=%ds, startup delay=15s)", interval)
    await asyncio.sleep(15.0)

    while True:
        await asyncio.sleep(interval)

        if not agent_state.agents_enabled:
            continue

        if time.time() < agent_state.optimizer_paused_until:
            remaining = int(agent_state.optimizer_paused_until - time.time())
            logger.info("Optimizer paused (%ds remaining)", remaining)
            continue

        if agent_state.pending_evaluation:
            logger.debug("Skipping — evaluator still pending")
            continue

        user_msg = _build_user_prompt(thresholds, metrics, queues)
        try:
            result = await _safe_llm_call(client, user_msg)
        except RateLimitError:
            _log_action(agent_state, "rate_limited", "Gemini rate limited — backing off 60s")
            await asyncio.sleep(60.0)
            continue

        if result is None:
            agent_state.optimizer_consecutive_failures += 1
            if agent_state.optimizer_consecutive_failures >= 5:
                agent_state.optimizer_paused_until = time.time() + 300
                _log_action(agent_state, "paused", "5 consecutive LLM failures — pausing 5min")
                logger.warning("5 consecutive failures — pausing optimizer for 5 minutes")
            continue

        agent_state.optimizer_consecutive_failures = 0
        changes = result.get("changes", {})
        reasoning = result.get("reasoning", "")
        confidence = result.get("confidence", 0.5)

        if not changes:
            _log_action(agent_state, "no_change", reasoning, confidence)
            logger.info("Optimizer: no changes proposed (confidence=%.2f)", confidence)
            continue

        if confidence < 0.4:
            _log_action(agent_state, "skipped", f"Low confidence ({confidence:.2f}): {reasoning}", confidence, changes)
            logger.info("Optimizer: skipped low-confidence proposal (%.2f)", confidence)
            continue

        error = _validate_changes(changes, thresholds)
        if error:
            _log_action(agent_state, "rejected", f"Validation failed: {error}", confidence, changes)
            logger.warning("Optimizer: rejected — %s", error)
            continue

        before_snap = capture_snapshot(metrics, queues)
        before_thresholds = thresholds.snapshot()

        thresholds.apply_changes(changes)

        agent_state.before_snapshot = before_snap
        agent_state.before_thresholds = before_thresholds
        agent_state.changes_applied = changes
        agent_state.optimizer_reasoning = reasoning
        agent_state.change_applied_at = time.time()
        agent_state.pending_evaluation = True

        change_summary = ", ".join(f"{k}={v}" for k, v in changes.items())
        _log_action(agent_state, "applied", f"{reasoning[:120]} | Changes: {change_summary}", confidence, changes)
        logger.info("Optimizer: applied changes (confidence=%.2f) — %s", confidence, change_summary)
