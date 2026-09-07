import asyncio
import json
import logging
import time

from jugaadflow.agents import get_client, call_llm, MODEL, LLMError
from jugaadflow.agents.state import AgentState, capture_snapshot
from jugaadflow.pipeline.thresholds import Thresholds
from jugaadflow.pipeline.strategy import Strategy
from jugaadflow.pipeline.queues import Queues
from jugaadflow.metrics.store import Metrics

logger = logging.getLogger("jugaadflow.evaluator")

SYSTEM_PROMPT = """You are a pipeline evaluation agent for JugaadFlow. Given before/after metrics snapshots and the configuration change that was applied, determine whether the change improved pipeline performance.

HARD RULE: If payment_shed increased above 0 in the "after" snapshot, you MUST recommend revert.

Evaluation criteria (in priority order):
1. Payment safety: payment_shed must be 0
2. Tier 1 latency: lower is better (critical events)
3. Total throughput: higher is better
4. Total shed: lower is better (less data loss)
5. Stability: fewer level transitions is better

Return ONLY valid JSON:
{
  "verdict": "keep" or "revert",
  "scores": {
    "t1_latency": "+X%" or "-X%" or "stable",
    "throughput": "+X%" or "-X%" or "stable",
    "shed_change": "+X" or "-X" or "none",
    "stability": "improved" or "degraded" or "neutral"
  },
  "reasoning": "one paragraph",
  "payment_safe": true or false
}"""


def _build_eval_prompt(agent_state: AgentState, after_snapshot) -> str:
    return json.dumps({
        "before_thresholds": agent_state.before_thresholds,
        "changes_applied": agent_state.changes_applied,
        "optimizer_reasoning": agent_state.optimizer_reasoning,
        "before_snapshot": agent_state.before_snapshot.to_dict() if agent_state.before_snapshot else {},
        "after_snapshot": after_snapshot.to_dict(),
    }, indent=2, default=str)


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
    except LLMError as e:
        logger.error("Evaluator LLM call failed: %s", e)
        return None
    except json.JSONDecodeError as e:
        logger.warning("Evaluator LLM returned invalid JSON: %s", e)
        return None
    except Exception as e:
        logger.error("Evaluator LLM call failed: %s", e)
        return None


def _log_action(agent_state: AgentState, action: str, summary: str,
                verdict: str | None = None, details: dict | None = None):
    ts = time.strftime("%H:%M:%S", time.localtime())
    entry = {
        "time": ts,
        "agent": "evaluator",
        "action": action,
        "summary": summary,
        "confidence": None,
        "verdict": verdict,
        "details": details or {},
    }
    agent_state.recent_actions.appendleft(entry)


def _do_revert(thresholds: Thresholds, agent_state: AgentState, reason: str):
    if agent_state.before_thresholds:
        thresholds.restore(agent_state.before_thresholds)
    agent_state.consecutive_reverts += 1
    agent_state.last_evaluation_result = "revert"
    agent_state.pending_evaluation = False

    _log_action(agent_state, "reverted", reason, verdict="revert",
                details={"changes_reverted": agent_state.changes_applied})

    logger.info("Evaluator: REVERTED — %s (consecutive_reverts=%d)",
                reason, agent_state.consecutive_reverts)

    if agent_state.consecutive_reverts >= 3:
        pause_duration = 120
        agent_state.optimizer_paused_until = time.time() + pause_duration
        _log_action(agent_state, "paused_optimizer",
                    f"3+ consecutive reverts — pausing optimizer for {pause_duration}s")
        logger.warning("Evaluator: pausing optimizer for %ds after %d consecutive reverts",
                       pause_duration, agent_state.consecutive_reverts)


async def evaluator_loop(
    thresholds: Thresholds,
    strategy: Strategy,
    queues: Queues,
    metrics: Metrics,
    agent_state: AgentState,
):
    client = get_client()
    if not client:
        logger.warning("No Anthropic client — evaluator disabled")
        return

    logger.info("Evaluator agent starting")

    while True:
        await asyncio.sleep(2.0)

        if not agent_state.agents_enabled:
            continue

        if not agent_state.pending_evaluation:
            continue

        elapsed = time.time() - agent_state.change_applied_at
        if elapsed < agent_state.validation_window:
            continue

        after_snap = capture_snapshot(metrics, queues)

        if after_snap.payment_shed > 0:
            _do_revert(thresholds, agent_state, "CRITICAL: payment_shed > 0 detected")
            continue

        user_msg = _build_eval_prompt(agent_state, after_snap)
        result = await _safe_llm_call(client, user_msg)

        if result is None:
            _log_action(agent_state, "eval_failed", "LLM call failed — keeping current thresholds")
            agent_state.pending_evaluation = False
            agent_state.last_evaluation_result = "keep"
            logger.warning("Evaluator: LLM failed — defaulting to keep")
            continue

        verdict = result.get("verdict", "keep")
        payment_safe = result.get("payment_safe", True)
        reasoning = result.get("reasoning", "")
        scores = result.get("scores", {})

        if not payment_safe:
            _do_revert(thresholds, agent_state, f"LLM flagged payment unsafe: {reasoning}")
            continue

        if verdict == "revert":
            _do_revert(thresholds, agent_state, reasoning)
            continue

        agent_state.consecutive_reverts = 0
        agent_state.last_evaluation_result = "keep"
        agent_state.pending_evaluation = False

        _log_action(agent_state, "approved", reasoning, verdict="keep", details=scores)
        logger.info("Evaluator: APPROVED changes — %s", reasoning[:120])
