import asyncio
from dataclasses import dataclass


@dataclass
class Queues:
    input_queue: asyncio.Queue
    tier1: asyncio.Queue
    tier2: asyncio.Queue
    tier3: asyncio.Queue
    tier4: asyncio.Queue
    deferred_tier2: asyncio.Queue
    deferred_tier3: asyncio.Queue
    fifo: asyncio.Queue
    kafka_overflow: asyncio.Queue

    def tier(self, priority: int) -> asyncio.Queue:
        return {1: self.tier1, 2: self.tier2, 3: self.tier3, 4: self.tier4}[priority]

    def deferred(self, priority: int) -> asyncio.Queue | None:
        return {2: self.deferred_tier2, 3: self.deferred_tier3}.get(priority)


def create_queues() -> Queues:
    return Queues(
        input_queue=asyncio.Queue(maxsize=10000),
        tier1=asyncio.Queue(maxsize=0),
        tier2=asyncio.Queue(maxsize=5000),
        tier3=asyncio.Queue(maxsize=2000),
        tier4=asyncio.Queue(maxsize=500),
        deferred_tier2=asyncio.Queue(maxsize=3000),
        deferred_tier3=asyncio.Queue(maxsize=2000),
        fifo=asyncio.Queue(maxsize=0),
        kafka_overflow=asyncio.Queue(maxsize=0),
    )
