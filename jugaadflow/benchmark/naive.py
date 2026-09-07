import asyncio
import time

from jugaadflow.generator.event import Event
from jugaadflow.pipeline.classifier import PRIORITY_MAP
from jugaadflow.metrics.store import Metrics
from jugaadflow.pipeline.worker import PROCESSING_TIME


async def naive_classifier_loop(input_queue: asyncio.Queue, fifo_queue: asyncio.Queue, metrics: Metrics):
    while True:
        event = await input_queue.get()
        event.priority = PRIORITY_MAP[event.type]
        await fifo_queue.put(event)


async def naive_worker(worker_id: int, fifo_queue: asyncio.Queue, metrics: Metrics):
    while True:
        event = await fifo_queue.get()
        await asyncio.sleep(PROCESSING_TIME[event.type])
        latency = time.time() - event.created_at
        metrics.record_processed(event, latency)
