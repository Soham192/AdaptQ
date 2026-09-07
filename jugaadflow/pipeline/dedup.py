import asyncio
import time


class DedupFilter:
    def __init__(self, ttl: float = 30.0):
        self.ttl = ttl
        self._seen: dict[str, float] = {}

    def _make_key(self, event) -> str:
        p = event.payload
        t = event.type
        if t == "payment":
            return f"payment:{p.get('transaction_id', '')}"
        elif t == "order":
            return f"order:{p.get('order_id', '')}"
        elif t == "inventory":
            return f"inventory:{p.get('sku', '')}:{p.get('warehouse', '')}"
        elif t == "click":
            return f"click:{p.get('session_id', '')}:{p.get('page', '')}:{p.get('element', '')}"
        elif t == "log":
            return f"log:{p.get('trace_id', '')}"
        return f"{t}:{event.id}"

    def is_duplicate(self, event) -> bool:
        key = self._make_key(event)
        now = time.time()
        if key in self._seen and (now - self._seen[key]) < self.ttl:
            return True
        self._seen[key] = now
        return False

    def purge_expired(self):
        now = time.time()
        expired = [k for k, ts in self._seen.items() if (now - ts) >= self.ttl]
        for k in expired:
            del self._seen[k]

    @property
    def size(self) -> int:
        return len(self._seen)


async def dedup_purge_loop(dedup_filter: DedupFilter, interval: float = 5.0):
    while True:
        await asyncio.sleep(interval)
        dedup_filter.purge_expired()
