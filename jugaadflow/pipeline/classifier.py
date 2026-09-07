import asyncio
import time

from jugaadflow.generator.event import Event
from jugaadflow.pipeline.queues import Queues
from jugaadflow.pipeline.overflow import route_to_queue
from jugaadflow.pipeline.strategy import Strategy
from jugaadflow.metrics.store import Metrics
from jugaadflow.pipeline.dedup import DedupFilter

PRIORITY_MAP = {
    "payment": 1,
    "order": 1,
    "inventory": 2,
    "click": 3,
    "log": 4,
}

TIER_STRATEGY_KEY = {2: "tier2", 3: "tier3", 4: "tier4"}


def _log_duplicate(metrics: Metrics, event: Event):
    ts = time.strftime("%H:%M:%S", time.localtime())
    metrics.recent_events.appendleft({
        "id": event.id,
        "type": event.type,
        "priority": event.priority,
        "queue": "dropped",
        "decision": "duplicate",
        "time": ts,
    })


async def classify_and_route(event: Event, queues: Queues, metrics: Metrics, strategy: Strategy, dedup_filter: DedupFilter | None = None):
    event.priority = PRIORITY_MAP[event.type]
    metrics.record_classified(event.priority, event.type)

    if dedup_filter is not None and dedup_filter.is_duplicate(event):
        metrics.duplicates_detected[event.type] += 1
        _log_duplicate(metrics, event)
        return

    if strategy.naive_mode:
        await queues.fifo.put(event)
        return

    strat_key = TIER_STRATEGY_KEY.get(event.priority)
    if strat_key and getattr(strategy, strat_key) == "defer":
        deferred = queues.deferred(event.priority)
        if deferred is not None:
            try:
                deferred.put_nowait(event)
                metrics.deferred_count[event.type] += 1
                return
            except asyncio.QueueFull:
                metrics.shed_count[event.type] += 1
                return

    await route_to_queue(event, queues, metrics)


async def classifier_loop(queues: Queues, metrics: Metrics, strategy: Strategy | None = None, dedup_filter: DedupFilter | None = None):
    if strategy is None:
        strategy = Strategy()
    count = 0
    window_start = time.time()
    while True:
        event = await queues.input_queue.get()
        await classify_and_route(event, queues, metrics, strategy, dedup_filter)
        count += 1
        now = time.time()
        if now - window_start >= 1.0:
            metrics.incoming_rate = count / (now - window_start)
            count = 0
            window_start = now
