# JugaadFlow — Architecture

## System Overview

JugaadFlow is a single-process Python asyncio application. All components run as concurrent async tasks within one process, communicating through shared in-memory queues and objects. No external infrastructure (no Kafka, no Redis, no databases).

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Single Python Process                               │
│                                                                              │
│  ┌───────────┐    ┌───────────┐    ┌──────────┐    ┌──────────────────────┐  │
│  │  Event     │    │           │    │Classifier│    │   Tier Queues        │  │
│  │ Generator  │───►│  Input    │───►│          │───►│                      │  │
│  │ (multiple  │    │  Queue    │    │ (static  │    │ Tier1 (unlimited)    │  │
│  │  sources)  │    │ (capped)  │    │  lookup) │    │ Tier2 (cap: 5000)   │  │
│  └───────────┘    └───────────┘    └──────────┘    │ Tier3 (cap: 2000)   │  │
│       ▲                                            │ Tier4 (cap: 500)    │  │
│       │                                            └─────────┬──────────┘  │
│  ┌────┴─────┐                                                │             │
│  │Dashboard  │                                     ┌─────────▼──────────┐  │
│  │ Spike Btn │                                     │  Overflow Router    │  │
│  └──────────┘                                      │                    │  │
│                                                    │ Tier1 full → WAIT  │  │
│                                                    │ Tier2 full → defer │  │
│                                                    │ Tier3 full → defer │  │
│                                                    │ Tier4 full → shed  │  │
│                                                    └────┬───────────┬───┘  │
│                                                         │           │      │
│                                            ┌────────────▼──┐  ┌────▼────┐  │
│                                            │Deferred Queues│  │Shed     │  │
│                                            │               │  │Counter  │  │
│                                            │ Def-Tier2     │  └─────────┘  │
│                                            │ Def-Tier3     │               │
│                                            └──────┬────────┘               │
│                                                   │                        │
│  ┌──────────────┐    ┌────────────┐    ┌──────────▼────────┐               │
│  │  Feedback     │───►│  Strategy   │───►│    Workers (8)    │              │
│  │  Loop         │    │  Object     │    │                   │              │
│  │ (every 3 sec) │    │            │    │  Pull order:       │              │
│  └──────▲───────┘    └────────────┘    │  1. Tier1 queue    │              │
│         │                              │  2. Tier2 queue    │              │
│         │                              │  3. Tier3 queue    │              │
│         │                              │  4. Tier4 queue    │              │
│  ┌──────┴───────┐                      │  5. Deferred-T2   │              │
│  │   Metrics     │◄────────────────────│  6. Deferred-T3   │              │
│  │   Store       │                     │                   │              │
│  │              │                      └───────┬───────────┘              │
│  │ - latency/   │                              │                          │
│  │   tier       │                              ▼                          │
│  │ - queue      │                         ┌─────────┐                     │
│  │   depths     │                         │  Sink    │                     │
│  │ - throughput  │                         │ (log +   │                     │
│  │ - shed/defer │                         │ metrics) │                     │
│  │   counts     │                         └─────────┘                     │
│  └──────┬───────┘                                                         │
│         │                                                                  │
│         ▼                                                                  │
│  ┌──────────────────────────────────────┐                                  │
│  │  Dashboard Server (FastAPI)          │                                  │
│  │  - WebSocket push every 1 sec        │                                  │
│  │  - Serves static HTML + Chart.js     │                                  │
│  │  - Spike trigger endpoint            │                                  │
│  │  - Naive mode toggle endpoint        │                                  │
│  └──────────────────────────────────────┘                                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Details

### 1. Event Generator

```
Sources (async loops):
├── payment_source()    → ~4% of events,  interval: 0.5–2.0s
├── order_source()      → ~9% of events,  interval: 0.3–1.0s
├── inventory_source()  → ~13% of events, interval: 0.1–0.5s
├── click_source()      → ~28% of events, interval: 0.01–0.1s
└── log_source()        → ~46% of events, interval: 0.01–0.05s
```

- All sources push into a shared **Input Queue** (`asyncio.Queue` with maxsize)
- Rate controlled by a shared `rate_multiplier` variable
- Spike = set `rate_multiplier` from 1 to 20 (all source intervals shrink by 20x)
- Burstiness: random jitter of ±25% on each tick's event count
- Each event stamped with `created_at = time.time()` at creation

**Event schema:**
```python
@dataclass
class Event:
    id: str              # "evt-00482"
    type: str            # "payment" | "order" | "inventory" | "click" | "log"
    priority: int        # assigned by classifier, not generator
    created_at: float    # time.time() at creation — latency start
    source: str          # "payment-gateway" | "order-service" | etc.
    payload: dict        # fake but realistic data
```

### 2. Classifier

```python
PRIORITY_MAP = {
    "payment": 1,
    "order": 1,
    "inventory": 2,
    "click": 3,
    "log": 4
}
```

- Pulls from Input Queue
- Tags `event.priority = PRIORITY_MAP[event.type]`
- Routes to the corresponding tier queue
- If tier queue is full, routes to overflow handler

### 3. Queue Architecture

```
                    ┌─────────────────────────┐
                    │     Tier Queues          │
                    │                         │
Input ──► Class ───►│ Tier 1: maxsize=0       │──► Workers
                    │ Tier 2: maxsize=5000    │
                    │ Tier 3: maxsize=2000    │
                    │ Tier 4: maxsize=500     │
                    └────────────┬────────────┘
                                 │ overflow
                    ┌────────────▼────────────┐
                    │   Deferred Queues        │
                    │                         │
                    │ Def-Tier2: maxsize=3000  │──► Workers (during recovery)
                    │ Def-Tier3: maxsize=2000  │
                    └────────────┬────────────┘
                                 │ overflow
                    ┌────────────▼────────────┐
                    │   Shed (counter only)    │
                    │   No storage — event     │
                    │   is discarded, count    │
                    │   incremented            │
                    └─────────────────────────┘
```

**Overflow routing logic:**
```python
async def route_to_queue(event):
    queue = tier_queues[event.priority]
    try:
        queue.put_nowait(event)
    except asyncio.QueueFull:
        if event.priority == 1:
            await queue.put(event)  # block = backpressure
        elif event.priority in (2, 3):
            deferred = deferred_queues[event.priority]
            try:
                deferred.put_nowait(event)
                metrics.deferred_count[event.type] += 1
            except asyncio.QueueFull:
                metrics.shed_count[event.type] += 1  # last resort
        else:  # tier 4
            metrics.shed_count[event.type] += 1  # shed immediately
```

### 4. Decision Engine

**Strategy object (shared, read by workers, written by feedback loop):**
```python
@dataclass
class Strategy:
    level: int = 0  # 0=Normal, 1=Elevated, 2=Critical, 3=Emergency
    tier2: str = "process"   # "process" | "batch" | "defer"
    tier3: str = "process"   # "process" | "batch" | "defer"
    tier4: str = "process"   # "process" | "batch" | "defer" | "shed"
    batch_sizes: dict        # {tier2: 20, tier3: 50, tier4: 100}
    shed_sample_rate: float  # 0.1 = keep 10%, shed 90%
    drain_deferred: bool = False
```

**Escalation levels:**

| Level | Name | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|-------|------|--------|--------|--------|--------|
| 0 | Normal | process | process | process | process |
| 1 | Elevated | process | process | batch(50) | batch(100) |
| 2 | Critical | process | batch(20) | defer | shed(10%) |
| 3 | Emergency | process+BP | defer | defer | shed(5%) |

**Feedback loop (separate async task):**
```
Every 3 seconds:
    1. Read: tier1_latency, tier1_queue_depth, worker_utilization, incoming_rate
    2. Check escalation triggers
    3. If escalating: change level immediately
    4. If de-escalating: only if condition sustained for 6 seconds (2 cycles)
    5. Update strategy object
    6. Log level change for dashboard
```

**Escalation triggers:**
```
→ Elevated:   t1_latency > 80ms  OR t1_queue > 100
→ Critical:   t1_latency > 150ms OR t1_queue > 500
→ Emergency:  t1_latency > 300ms OR t1_queue > 1000
```

**De-escalation triggers (sustained 6 seconds):**
```
→ Critical:   t1_latency < 100ms AND t1_queue < 200
→ Elevated:   t1_latency < 60ms  AND t1_queue < 50
→ Normal:     t1_latency < 40ms  AND t1_queue < 10
```

### 5. Workers

**8 fixed async workers**, all running identical code:

```python
async def worker(id, queues, strategy, metrics, sink):
    while True:
        if not queues.tier1.empty():
            event = await queues.tier1.get()
            await process_individual(event, metrics, sink)

        elif not queues.tier2.empty() and strategy.tier2 != "defer":
            if strategy.tier2 == "batch":
                await process_batch(queues.tier2, strategy.batch_sizes["tier2"], metrics, sink)
            else:
                event = await queues.tier2.get()
                await process_individual(event, metrics, sink)

        elif not queues.tier3.empty() and strategy.tier3 not in ("defer", "shed"):
            if strategy.tier3 == "batch":
                await process_batch(queues.tier3, strategy.batch_sizes["tier3"], metrics, sink)
            else:
                event = await queues.tier3.get()
                await process_individual(event, metrics, sink)

        elif not queues.tier4.empty() and strategy.tier4 != "defer":
            if strategy.tier4 == "shed":
                event = queues.tier4.get_nowait()
                if random.random() < strategy.shed_sample_rate:
                    await process_individual(event, metrics, sink)
                else:
                    metrics.shed_count[event.type] += 1
            elif strategy.tier4 == "batch":
                await process_batch(queues.tier4, strategy.batch_sizes["tier4"], metrics, sink)
            else:
                event = await queues.tier4.get()
                await process_individual(event, metrics, sink)

        elif not queues.deferred_tier2.empty() and strategy.drain_deferred:
            event = await queues.deferred_tier2.get()
            await process_individual(event, metrics, sink)

        elif not queues.deferred_tier3.empty() and strategy.drain_deferred:
            event = await queues.deferred_tier3.get()
            await process_individual(event, metrics, sink)

        else:
            await asyncio.sleep(0.01)
```

**Simulated processing times:**
```python
PROCESSING_TIME = {
    "payment": 0.05,    # 50ms — expensive
    "order": 0.04,      # 40ms
    "inventory": 0.02,  # 20ms
    "click": 0.01,      # 10ms
    "log": 0.005        # 5ms — cheap
}
```

**Batch processing:**
```python
async def process_batch(queue, batch_size, metrics, sink):
    batch = []
    for _ in range(batch_size):
        if not queue.empty():
            batch.append(queue.get_nowait())
        else:
            break  # take what's there, don't wait
    if batch:
        await asyncio.sleep(0.05)  # one round-trip for all
        for event in batch:
            record_completion(event, metrics, sink, action="batched")
```

### 6. Backpressure

**Two layers:**

1. **Implicit:** Input queue has maxsize. When full, generator's `put()` blocks. Pressure propagates: generator slows → events arrive slower → system copes.

2. **Explicit:** Feedback loop monitors tier 1 queue depth. When it exceeds 80% of a soft threshold, sets `backpressure_active = True`. Dashboard shows this. When depth drops and sustains below threshold for 6 seconds, releases.

```python
# In feedback loop
if tier1_queue.qsize() > BACKPRESSURE_THRESHOLD:
    metrics.backpressure_active = True
    log("Backpressure applied")
elif metrics.backpressure_active and tier1_queue.qsize() < BACKPRESSURE_RELEASE:
    if sustained_for(6):
        metrics.backpressure_active = False
        log("Backpressure released")
```

### 7. Metrics Store

Shared object read by dashboard and feedback loop:

```python
@dataclass
class Metrics:
    # Per-tier latency samples (rolling window)
    latency_samples: dict[int, deque]  # tier → recent latencies

    # Per-tier queue depths (read from queues directly)
    # No storage needed — just queue.qsize()

    # Per-type counters
    processed_count: dict[str, int]
    shed_count: dict[str, int]
    deferred_count: dict[str, int]
    batched_count: dict[str, int]

    # Throughput (per-tier, reset every second)
    throughput_window: dict[int, int]

    # System state
    current_level: int
    backpressure_active: bool
    incoming_rate: float
```

### 8. Dashboard Server

**Backend (FastAPI):**
```
GET  /                    → serves index.html
WS   /ws                  → pushes metrics JSON every 1 second
POST /api/spike           → sets generator rate to 20,000/min
POST /api/normal          → sets generator rate to 1,000/min
POST /api/mode/naive      → enables naive mode
POST /api/mode/adaptive   → enables adaptive mode
```

**Frontend (HTML + Chart.js):**
- Two live line charts: latency/tier over time, throughput over time
- Four queue depth displays (numbers or bar chart)
- Counter displays: shed, deferred, batched per type
- Current level indicator with color (green/yellow/orange/red)
- Backpressure indicator
- Spike trigger button
- Mode toggle (Adaptive / Naive)

**WebSocket payload (sent every second):**
```json
{
    "timestamp": 1725436800.123,
    "level": 2,
    "level_name": "CRITICAL",
    "backpressure": false,
    "queues": {
        "tier1": 12,
        "tier2": 340,
        "tier3": 0,
        "tier4": 0,
        "deferred_tier2": 180,
        "deferred_tier3": 1200
    },
    "latency_ms": {
        "tier1": 42,
        "tier2": 180,
        "tier3": null,
        "tier4": null
    },
    "throughput_per_sec": {
        "tier1": 45,
        "tier2": 38,
        "tier3": 0,
        "tier4": 0
    },
    "counters": {
        "processed": {"payment": 892, "order": 1841, ...},
        "shed": {"log": 600, "payment": 0, ...},
        "deferred": {"click": 1800, ...},
        "batched": {"click": 4200, ...}
    },
    "incoming_rate": 333
}
```

### 9. Naive Mode

When `naive_mode = True`:
- Classifier routes ALL events into a single FIFO queue (ignores priority)
- Feedback loop disabled
- Workers pull FIFO — payment waits behind logs
- No batching, no deferring, no shedding
- Metrics still collected per tier (for comparison)

```
Adaptive: Classifier → Tier 1/2/3/4 queues → Smart workers
Naive:    Classifier → Single FIFO queue    → Dumb workers
```

---

## Data Flow — Complete Path of a Single Event

```
1. Generator creates event with type="payment", created_at=now()
2. Generator pushes to Input Queue
3. Classifier pulls from Input Queue
4. Classifier tags: priority=1
5. Classifier routes to Tier 1 Queue
6. Worker checks Tier 1 first — finds event
7. Worker reads strategy — tier 1 is always "process"
8. Worker calls process_individual():
   a. await asyncio.sleep(0.05)  # simulate 50ms payment processing
   b. latency = now() - event.created_at
   c. metrics.latency_samples[1].append(latency)
   d. metrics.processed_count["payment"] += 1
   e. sink.append(completion_record)
9. Worker loops back to step 6
```

---

## Concurrency Model

```
asyncio.gather(
    generator.payment_source(),
    generator.order_source(),
    generator.inventory_source(),
    generator.click_source(),
    generator.log_source(),
    classifier.run(),
    worker(0), worker(1), worker(2), worker(3),
    worker(4), worker(5), worker(6), worker(7),
    feedback_loop.run(),
    metrics_broadcaster.run(),    # WebSocket push every 1s
    dashboard_server.run()        # FastAPI
)
```

All on one thread. Cooperative multitasking via `await`. Workers yield at every `asyncio.sleep()` and `queue.get()/put()`.

---

## Project Structure

```
jugaadflow/
├── main.py                # Entry point — asyncio.gather all components
├── generator/
│   ├── __init__.py
│   ├── sources.py         # Event source loops (payment, order, etc.)
│   ├── event.py           # Event dataclass
│   └── payloads.py        # Fake payload generators
├── pipeline/
│   ├── __init__.py
│   ├── classifier.py      # Priority tagging + queue routing
│   ├── queues.py          # Queue setup (tier queues + deferred queues)
│   ├── overflow.py        # Overflow routing logic
│   ├── worker.py          # Worker loop + process/batch/shed logic
│   ├── strategy.py        # Strategy dataclass
│   └── decision_engine.py # Feedback loop + escalation levels
├── metrics/
│   ├── __init__.py
│   └── store.py           # Metrics dataclass + recording helpers
├── dashboard/
│   ├── __init__.py
│   ├── server.py          # FastAPI app + WebSocket + API endpoints
│   └── static/
│       ├── index.html      # Dashboard page
│       ├── dashboard.js    # Chart.js charts + WebSocket client
│       └── style.css       # Styling
├── benchmark/
│   ├── __init__.py
│   └── naive.py           # Naive mode toggle logic
├── requirements.txt
├── README.md
└── CLAUDE.md
```
