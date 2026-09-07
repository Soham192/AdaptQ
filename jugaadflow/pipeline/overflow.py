import asyncio
import time

from jugaadflow.generator.event import Event
from jugaadflow.pipeline.queues import Queues
from jugaadflow.metrics.store import Metrics


def _log_event(metrics: Metrics, event: Event, queue: str, decision: str):
    ts = time.strftime("%H:%M:%S", time.localtime())
    metrics.recent_events.appendleft({
        "id": event.id,
        "type": event.type,
        "priority": event.priority,
        "queue": queue,
        "decision": decision,
        "time": ts,
    })


async def route_to_queue(event: Event, queues: Queues, metrics: Metrics):
    queue = queues.tier(event.priority)

    try:
        queue.put_nowait(event)
        _log_event(metrics, event, f"tier{event.priority}", "process")
    except asyncio.QueueFull:
        if event.priority == 1:
            _log_event(metrics, event, "tier1", "backpressure")
            await queue.put(event)
        elif event.priority in (2, 3):
            deferred = queues.deferred(event.priority)
            try:
                deferred.put_nowait(event)
                metrics.deferred_count[event.type] += 1
                _log_event(metrics, event, f"deferred_tier{event.priority}", "defer")
            except asyncio.QueueFull:
                metrics.shed_count[event.type] += 1
                _log_event(metrics, event, "shed", "shed")
        else:
            metrics.shed_count[event.type] += 1
            _log_event(metrics, event, "shed", "shed")
