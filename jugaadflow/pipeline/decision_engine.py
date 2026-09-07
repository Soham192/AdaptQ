import asyncio
import logging
import time

from jugaadflow.pipeline.queues import Queues
from jugaadflow.pipeline.strategy import Strategy
from jugaadflow.pipeline.thresholds import Thresholds
from jugaadflow.metrics.store import Metrics

logger = logging.getLogger("jugaadflow.decision")

LEVEL_NAMES = {0: "NORMAL", 1: "ELEVATED", 2: "CRITICAL", 3: "EMERGENCY"}

LEVEL_STRATEGIES = {
    0: {"tier2": "process", "tier3": "process", "tier4": "process",
        "batch_sizes": {"tier2": 20, "tier3": 50, "tier4": 100},
        "shed_sample_rate": 0.1, "drain_deferred": True},
    1: {"tier2": "process", "tier3": "batch", "tier4": "batch",
        "batch_sizes": {"tier2": 20, "tier3": 50, "tier4": 100},
        "shed_sample_rate": 0.1, "drain_deferred": True},
    2: {"tier2": "batch", "tier3": "defer", "tier4": "shed",
        "batch_sizes": {"tier2": 20, "tier3": 50, "tier4": 100},
        "shed_sample_rate": 0.1, "drain_deferred": False},
    3: {"tier2": "defer", "tier3": "defer", "tier4": "shed",
        "batch_sizes": {"tier2": 20, "tier3": 50, "tier4": 100},
        "shed_sample_rate": 0.05, "drain_deferred": False},
}

DEESCALATION_COOLDOWN = 6.0
BACKPRESSURE_THRESHOLD = 8000
BACKPRESSURE_RELEASE = 5000


def _apply_level(strategy: Strategy, level: int, thresholds: Thresholds):
    config = LEVEL_STRATEGIES[level]
    params = thresholds.level_params[level]
    strategy.level = level
    strategy.tier2 = config["tier2"]
    strategy.tier3 = config["tier3"]
    strategy.tier4 = config["tier4"]
    strategy.batch_sizes = params.batch_sizes
    strategy.shed_sample_rate = params.shed_sample_rate
    strategy.drain_deferred = config["drain_deferred"]


def _total_lower_queue(queues: Queues) -> int:
    return queues.tier2.qsize() + queues.tier3.qsize() + queues.tier4.qsize()


def _check_escalation(t1_latency_ms: float, t1_queue: int, lower_q: int,
                       current_level: int, thresholds: Thresholds) -> int | None:
    for target_level in (3, 2, 1):
        if current_level < target_level:
            t = thresholds.escalation[target_level]
            if t1_latency_ms > t.t1_latency_ms or t1_queue > t.t1_queue or lower_q > t.lower_queue:
                return target_level
    return None


def _check_deescalation(t1_latency_ms: float, t1_queue: int, lower_q: int,
                         lower_q_shrinking: bool, current_level: int,
                         thresholds: Thresholds) -> int | None:
    if current_level == 0:
        return None
    t = thresholds.deescalation[current_level]
    if current_level in (3, 2):
        if t1_latency_ms < t.t1_latency_ms and t1_queue < t.t1_queue and lower_q_shrinking:
            return current_level - 1
    elif current_level == 1:
        if t1_latency_ms < t.t1_latency_ms and t1_queue < t.t1_queue and lower_q < (t.lower_queue or 20):
            return 0
    return None


def _log_decision(metrics: Metrics, old_level: int, new_level: int,
                   t1_lat: float, t1_q: int, lower_q: int, direction: str):
    ts = time.strftime("%H:%M:%S", time.localtime())
    config = LEVEL_STRATEGIES[new_level]
    strategy_desc = f"t2={config['tier2']} t3={config['tier3']} t4={config['tier4']}"
    metrics.recent_decisions.appendleft({
        "time": ts,
        "from_level": LEVEL_NAMES[old_level],
        "to_level": LEVEL_NAMES[new_level],
        "t1_latency": f"{t1_lat:.1f}ms",
        "t1_queue": str(t1_q),
        "lower_queue": str(lower_q),
        "direction": direction,
        "reason": strategy_desc,
    })


async def feedback_loop(queues: Queues, strategy: Strategy, metrics: Metrics,
                        thresholds: Thresholds | None = None, interval: float = 3.0):
    if thresholds is None:
        thresholds = Thresholds()
    deescalation_pending_since: float | None = None
    deescalation_target: int | None = None
    prev_lower_q: int = 0
    heartbeat_counter: int = 0
    idle_ticks: int = 0

    while True:
        await asyncio.sleep(interval)

        if strategy.naive_mode:
            continue

        total_throughput = sum(metrics.throughput_window.values())
        if total_throughput == 0:
            idle_ticks += 1
        else:
            idle_ticks = 0
        if idle_ticks >= 2:
            for tier in metrics.latency_samples:
                metrics.latency_samples[tier].clear()

        t1_queue = queues.tier1.qsize()
        t1_latency_ms = metrics.avg_latency_ms(1) or 0.0
        lower_q = _total_lower_queue(queues)
        lower_q_shrinking = lower_q <= prev_lower_q or lower_q < 50
        old_level = strategy.level

        new_level = _check_escalation(t1_latency_ms, t1_queue, lower_q, strategy.level, thresholds)
        if new_level is not None:
            _apply_level(strategy, new_level, thresholds)
            metrics.current_level = new_level
            if new_level == 3 and metrics.emergency_since == 0.0:
                metrics.emergency_since = time.time()
            elif new_level < 3:
                metrics.emergency_since = 0.0
            deescalation_pending_since = None
            deescalation_target = None
            logger.info(
                "ESCALATED %s -> %s (t1_lat=%.1fms t1_q=%d lower_q=%d)",
                LEVEL_NAMES[old_level], LEVEL_NAMES[new_level], t1_latency_ms, t1_queue, lower_q,
            )
            _log_decision(metrics, old_level, new_level, t1_latency_ms, t1_queue, lower_q, "escalate")
            heartbeat_counter = 0
            prev_lower_q = lower_q
            continue

        de_target = _check_deescalation(t1_latency_ms, t1_queue, lower_q, lower_q_shrinking, strategy.level, thresholds)
        if de_target is not None:
            if deescalation_target == de_target and deescalation_pending_since is not None:
                if time.time() - deescalation_pending_since >= thresholds.deescalation_cooldown:
                    _apply_level(strategy, de_target, thresholds)
                    metrics.current_level = de_target
                    if old_level == 3 and de_target < 3:
                        metrics.emergency_since = 0.0
                    logger.info(
                        "DE-ESCALATED %s -> %s (t1_q=%d lower_q=%d)",
                        LEVEL_NAMES[old_level], LEVEL_NAMES[de_target], t1_queue, lower_q,
                    )
                    _log_decision(metrics, old_level, de_target, t1_latency_ms, t1_queue, lower_q, "de-escalate")
                    heartbeat_counter = 0
                    deescalation_pending_since = None
                    deescalation_target = None
            else:
                deescalation_pending_since = time.time()
                deescalation_target = de_target
        else:
            deescalation_pending_since = None
            deescalation_target = None

        heartbeat_counter += 1
        if heartbeat_counter >= 10:
            heartbeat_counter = 0
            config = LEVEL_STRATEGIES[strategy.level]
            strategy_desc = f"t2={config['tier2']} t3={config['tier3']} t4={config['tier4']}"
            metrics.recent_decisions.appendleft({
                "time": time.strftime("%H:%M:%S", time.localtime()),
                "from_level": LEVEL_NAMES[strategy.level],
                "to_level": LEVEL_NAMES[strategy.level],
                "t1_latency": f"{t1_latency_ms:.1f}ms",
                "t1_queue": str(t1_queue),
                "lower_queue": str(lower_q),
                "direction": "steady",
                "reason": strategy_desc,
            })

        input_depth = queues.input_queue.qsize()
        if input_depth > thresholds.backpressure_threshold and not metrics.backpressure_active:
            metrics.backpressure_active = True
            logger.info("BACKPRESSURE applied (input_q=%d)", input_depth)
        elif metrics.backpressure_active and input_depth < thresholds.backpressure_release:
            metrics.backpressure_active = False
            logger.info("BACKPRESSURE released (input_q=%d)", input_depth)

        prev_lower_q = lower_q
