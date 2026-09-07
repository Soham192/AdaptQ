import asyncio
import logging
import random
import time

from jugaadflow.generator.event import Event
from jugaadflow.pipeline.queues import Queues
from jugaadflow.pipeline.strategy import Strategy
from jugaadflow.metrics.store import Metrics

logger = logging.getLogger("jugaadflow.worker")

PROCESSING_TIME = {
    "payment": 0.05,
    "order": 0.04,
    "inventory": 0.02,
    "click": 0.01,
    "log": 0.005,
}

BATCH_PROCESSING_TIME = 0.05
MAX_RETRIES = 3
FAILURE_RATE = 0.05

AGING_RATE = 10.0
MAX_AGING_BONUS = 50
BASE_PRIORITY_SCORE = {2: 70, 3: 40, 4: 10}

BACKOFF_BASE_S = 0.5
BACKOFF_MAX_S = 5.0


class TransientError(Exception):
    pass


class PermanentError(Exception):
    pass


async def process_individual(event: Event, metrics: Metrics, completed_events: dict | None = None):
    if completed_events is not None and event.id in completed_events:
        metrics.idempotent_skips += 1
        return

    if event.priority >= 3 and random.random() < FAILURE_RATE:
        if random.random() < 0.8:
            raise TransientError(f"Transient failure for {event.id}")
        else:
            raise PermanentError(f"Permanent failure for {event.id}")

    await asyncio.sleep(PROCESSING_TIME[event.type])
    latency = time.time() - event.created_at
    metrics.record_processed(event, latency)

    if completed_events is not None:
        completed_events[event.id] = time.time()


async def process_batch(queue: asyncio.Queue, batch_size: int, metrics: Metrics, completed_events: dict | None = None):
    batch = []
    for _ in range(batch_size):
        if not queue.empty():
            try:
                batch.append(queue.get_nowait())
            except asyncio.QueueEmpty:
                break
        else:
            break
    if batch:
        await asyncio.sleep(BATCH_PROCESSING_TIME)
        for event in batch:
            if completed_events is not None and event.id in completed_events:
                metrics.idempotent_skips += 1
                continue
            latency = time.time() - event.created_at
            metrics.record_processed(event, latency)
            metrics.batched_count[event.type] += 1
            if completed_events is not None:
                completed_events[event.id] = time.time()


async def _delayed_requeue(event: Event, queue: asyncio.Queue, metrics: Metrics, dead_letter):
    delay = min(BACKOFF_BASE_S * (2 ** (event.retry_count - 1)), BACKOFF_MAX_S)
    await asyncio.sleep(delay)
    try:
        queue.put_nowait(event)
    except asyncio.QueueFull:
        metrics.dead_letter_count += 1
        if dead_letter is not None:
            dead_letter.append({
                "id": event.id, "type": event.type,
                "priority": event.priority, "retries": event.retry_count,
                "time": time.strftime("%H:%M:%S"),
            })


def _to_dead_letter(event: Event, metrics: Metrics, dead_letter, reason: str):
    metrics.dead_letter_count += 1
    if dead_letter is not None:
        dead_letter.append({
            "id": event.id, "type": event.type,
            "priority": event.priority, "retries": event.retry_count,
            "reason": reason,
            "time": time.strftime("%H:%M:%S"),
        })
    logger.warning("Dead-lettered %s: %s", event.id, reason)


def _handle_failure(event: Event, queues: Queues, metrics: Metrics, dead_letter):
    event.retry_count += 1
    if event.retry_count > MAX_RETRIES:
        _to_dead_letter(event, metrics, dead_letter, f"exceeded {MAX_RETRIES} retries")
    else:
        metrics.retries_total += 1
        queue = queues.tier(event.priority)
        asyncio.create_task(_delayed_requeue(event, queue, metrics, dead_letter))
        logger.info("Retry #%d for %s (backoff %.1fs)", event.retry_count, event.id,
                     min(BACKOFF_BASE_S * (2 ** (event.retry_count - 1)), BACKOFF_MAX_S))


def _effective_priority(event: Event) -> float:
    base = BASE_PRIORITY_SCORE.get(event.priority, 0)
    wait = time.time() - event.created_at
    aging = min(wait * AGING_RATE, MAX_AGING_BONUS)
    return base + aging


def _peek(queue: asyncio.Queue) -> Event | None:
    if queue.empty():
        return None
    try:
        return queue.get_nowait()
    except asyncio.QueueEmpty:
        return None


def _log_scheduling(metrics: Metrics, worker_id: int, event: Event, reason: str, effective: float | None):
    if reason == "strict_priority" and event.priority == 1:
        return
    metrics.recent_scheduling.appendleft({
        "time": time.strftime("%H:%M:%S"),
        "worker": worker_id,
        "event_type": event.type,
        "tier": event.priority,
        "reason": reason,
        "wait_ms": round((time.time() - event.created_at) * 1000),
        "effective_priority": round(effective, 1) if effective else None,
    })


async def worker(
    worker_id: int, queues: Queues, strategy: Strategy, metrics: Metrics,
    completed_events: dict | None = None,
    worker_kill_flags: list | None = None,
    dead_letter=None,
):
    while True:
        if worker_kill_flags and worker_kill_flags[worker_id]:
            await asyncio.sleep(0.1)
            continue

        if strategy.naive_mode:
            if not queues.fifo.empty():
                event = await queues.fifo.get()
                try:
                    await process_individual(event, metrics, completed_events)
                except PermanentError:
                    metrics.permanent_failures += 1
                    _to_dead_letter(event, metrics, dead_letter, "permanent failure")
                except TransientError:
                    _handle_failure(event, queues, metrics, dead_letter)
            else:
                await asyncio.sleep(0.01)
            continue

        event = None
        reason = "strict_priority"
        eff_score = None

        # Tier 1: ABSOLUTE priority — no aging competition, always first
        if not queues.tier1.empty():
            event = await queues.tier1.get()
            reason = "strict_priority"
            metrics.strict_priority_picks += 1

        else:
            # Among tier 2/3/4: aging-aware selection
            # Collect candidates from non-deferred, non-shed tiers
            candidates = []

            if not queues.tier2.empty() and strategy.tier2 != "defer":
                if strategy.tier2 == "batch":
                    await process_batch(queues.tier2, strategy.batch_sizes["tier2"], metrics, completed_events)
                    continue
                evt = _peek(queues.tier2)
                if evt:
                    candidates.append((evt, queues.tier2, 2))

            if not queues.tier3.empty() and strategy.tier3 != "defer":
                if strategy.tier3 == "batch":
                    if candidates:
                        for e, q, _ in candidates:
                            q.put_nowait(e)
                    await process_batch(queues.tier3, strategy.batch_sizes["tier3"], metrics, completed_events)
                    continue
                evt = _peek(queues.tier3)
                if evt:
                    candidates.append((evt, queues.tier3, 3))

            if not queues.tier4.empty():
                if strategy.tier4 == "shed":
                    try:
                        shed_evt = queues.tier4.get_nowait()
                    except asyncio.QueueEmpty:
                        shed_evt = None
                    if shed_evt:
                        if random.random() < strategy.shed_sample_rate:
                            candidates.append((shed_evt, None, 4))
                        else:
                            metrics.shed_count[shed_evt.type] += 1
                            try:
                                queues.kafka_overflow.put_nowait(shed_evt)
                            except asyncio.QueueFull:
                                pass
                elif strategy.tier4 == "batch":
                    if candidates:
                        for e, q, _ in candidates:
                            q.put_nowait(e)
                    await process_batch(queues.tier4, strategy.batch_sizes["tier4"], metrics, completed_events)
                    continue
                else:
                    evt = _peek(queues.tier4)
                    if evt:
                        candidates.append((evt, queues.tier4, 4))

            if candidates:
                if len(candidates) == 1:
                    event, src_q, tier = candidates[0]
                    eff_score = _effective_priority(event)
                    reason = "strict_priority"
                    metrics.strict_priority_picks += 1
                else:
                    scored = [(evt, q, t, _effective_priority(evt)) for evt, q, t in candidates]
                    scored.sort(key=lambda x: (-x[3], x[2]))
                    winner_evt, winner_q, winner_tier, winner_score = scored[0]

                    # Put back losers
                    for evt, q, t, _ in scored[1:]:
                        if q is not None:
                            try:
                                q.put_nowait(evt)
                            except asyncio.QueueFull:
                                pass

                    event = winner_evt
                    eff_score = winner_score
                    base = BASE_PRIORITY_SCORE.get(winner_tier, 0)
                    if winner_score - base > 5:
                        reason = "starvation_prevention"
                        metrics.starvation_preventions += 1
                    else:
                        reason = "strict_priority"
                        metrics.strict_priority_picks += 1

            # Deferred queues: drain when allowed
            elif not queues.deferred_tier2.empty() and strategy.drain_deferred:
                event = await queues.deferred_tier2.get()
                reason = "deferred_drain"

            elif not queues.deferred_tier3.empty() and strategy.drain_deferred:
                event = await queues.deferred_tier3.get()
                reason = "deferred_drain"

            else:
                await asyncio.sleep(0.01)
                continue

        if event is None:
            continue

        _log_scheduling(metrics, worker_id, event, reason, eff_score)

        try:
            await process_individual(event, metrics, completed_events)
        except PermanentError:
            metrics.permanent_failures += 1
            _to_dead_letter(event, metrics, dead_letter, "permanent failure")
        except TransientError:
            _handle_failure(event, queues, metrics, dead_letter)


async def completed_events_cleanup(completed_events: dict, ttl: float = 60.0, interval: float = 10.0):
    while True:
        await asyncio.sleep(interval)
        now = time.time()
        expired = [eid for eid, ts in completed_events.items() if (now - ts) >= ttl]
        for eid in expired:
            del completed_events[eid]


async def kafka_consumer_loop(queues: Queues, strategy: Strategy, interval: float = 0.5):
    while True:
        await asyncio.sleep(interval)
        if queues.kafka_overflow.empty():
            continue
        if strategy.level <= 1 and queues.input_queue.qsize() < 2000:
            batch_size = min(100, queues.kafka_overflow.qsize())
            for _ in range(batch_size):
                try:
                    event = queues.kafka_overflow.get_nowait()
                    queues.input_queue.put_nowait(event)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    break
