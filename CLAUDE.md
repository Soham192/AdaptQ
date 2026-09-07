# CLAUDE.md — JugaadFlow

## Project Overview

JugaadFlow is an intelligent adaptive data pipeline built for the UCET 2026 Hack-o-thon. It handles a 20x traffic spike using fixed resources by making smart per-event decisions: process, batch, defer, or shed — based on event priority and real-time system state.

**Core principle:** Not all events matter equally. Payments are critical and never dropped. Logs are noise and can be shed. The pipeline's intelligence comes from recognizing and acting on this difference using the same 8 workers throughout.

## Tech Stack

- **Python 3.11+** with asyncio (single thread, cooperative concurrency)
- **FastAPI** for dashboard server + WebSocket
- **Chart.js** for live frontend charts
- **No external infrastructure** — no Kafka, no Redis, no databases. Everything in-memory.

## Architecture Summary

Single process, all components as async tasks:

```
Generator → Input Queue → Classifier → Tier Queues (1-4) → Workers (8) → Sink
                                            ↓ overflow
                                       Deferred Queues → Workers (during recovery)
                                            ↓ overflow
                                       Shed (counter only)

Feedback Loop (every 3s): reads metrics → updates strategy → workers follow
Dashboard: FastAPI + WebSocket → HTML + Chart.js
```

See `architecture.md` for full details, data flow, component specs, and queue sizing.
See `plan.md` for all architecture decisions, escalation levels, time budget, and demo script.

## Key Design Decisions

1. **Single process** — generator, pipeline, dashboard all in one `python main.py`
2. **Multiple queues per tier** — NOT a single priority queue. Enables clean batching, deferring, shedding per tier.
3. **Tier-specific deferred queues** — Deferred Tier 2 and Deferred Tier 3 are separate so priority is maintained during recovery.
4. **Level-based escalation** — 4 levels (Normal/Elevated/Critical/Emergency) driven by tier 1 latency and queue depth.
5. **Fast escalation, slow de-escalation** — escalate immediately, de-escalate one level at a time after 6-second cooldown.
6. **Fixed 8 workers, strict priority** — workers always check tier 1 first. No worker specialization.
7. **Naive mode as a flag** — toggle that disables all intelligence and routes through single FIFO queue for benchmark comparison.

## Coding Guidelines

### Event Schema
```python
@dataclass
class Event:
    id: str              # "evt-{uuid4_short}"
    type: str            # "payment" | "order" | "inventory" | "click" | "log"
    priority: int        # 1 (critical) to 4 (noise) — set by classifier
    created_at: float    # time.time() — MUST be set at creation for latency
    source: str          # "payment-gateway" | "order-service" | etc.
    payload: dict        # fake but realistic
```

### Priority Mapping (static, never changes at runtime)
```
payment   → 1 (critical, never dropped, never deferred)
order     → 1
inventory → 2 (important, can defer under pressure)
click     → 3 (useful, can batch/defer/shed)
log       → 4 (noise, shed freely)
```

### Queue Sizing
```python
input_queue     = asyncio.Queue(maxsize=10000)
tier1_queue     = asyncio.Queue(maxsize=0)       # unlimited
tier2_queue     = asyncio.Queue(maxsize=5000)
tier3_queue     = asyncio.Queue(maxsize=2000)
tier4_queue     = asyncio.Queue(maxsize=500)
deferred_tier2  = asyncio.Queue(maxsize=3000)
deferred_tier3  = asyncio.Queue(maxsize=2000)
```

### Overflow Routing
```
Tier 1 full → await put() (blocks = backpressure)
Tier 2 full → deferred_tier2 → shed if deferred full
Tier 3 full → deferred_tier3 → shed if deferred full
Tier 4 full → shed immediately (increment counter)
```

### Escalation Levels
```
Level 0 (Normal):    all tiers process individually
Level 1 (Elevated):  tier 3+4 batch
Level 2 (Critical):  tier 2 batch, tier 3 defer, tier 4 shed (sample 10%)
Level 3 (Emergency): tier 2+3 defer, tier 4 shed (sample 5%)
```

### Escalation Triggers (tier 1 metrics only)
```
→ Elevated:  t1_latency > 80ms  OR t1_queue > 100
→ Critical:  t1_latency > 150ms OR t1_queue > 500
→ Emergency: t1_latency > 300ms OR t1_queue > 1000
```

### De-escalation (sustained 6 seconds before stepping down)
```
→ Critical: t1_latency < 100ms AND t1_queue < 200
→ Elevated: t1_latency < 60ms  AND t1_queue < 50
→ Normal:   t1_latency < 40ms  AND t1_queue < 10
```

### Simulated Processing Times
```python
PROCESSING_TIME = {
    "payment": 0.05,    # 50ms
    "order": 0.04,      # 40ms
    "inventory": 0.02,  # 20ms
    "click": 0.01,      # 10ms
    "log": 0.005        # 5ms
}
```

### Worker Pull Order (strict, never varies)
```
1. tier1_queue        → always process
2. tier2_queue        → process/batch per strategy
3. tier3_queue        → process/batch per strategy (skip if deferred)
4. tier4_queue        → process/batch/shed per strategy (skip if deferred)
5. deferred_tier2     → only when strategy.drain_deferred is True
6. deferred_tier3     → only when strategy.drain_deferred is True
7. nothing            → asyncio.sleep(0.01)
```

### Batch Processing
- Batch = pull up to N events at once, process in one sleep cycle
- Batch size is a maximum, not a target — take what's available
- One `asyncio.sleep(0.05)` for the whole batch (amortized cost)

### Shedding
- Only tier 4 is fully shed; tier 2 and 3 are deferred first
- Shedding with sampling: keep 1 in N (configurable), drop rest
- Every shed event increments `shed_count[event.type]`
- **`shed_count["payment"]` must always be 0** — this is the proof

### Metrics Recording
Every processed event records:
- `latency = time.time() - event.created_at` (end-to-end)
- `processed_count[event.type] += 1`
- `throughput_window[event.priority] += 1`

### Dashboard WebSocket
- Push metrics JSON every 1 second
- Include: queue depths, latency per tier, throughput per tier, shed/defer/batch counts, current level, backpressure status

### Naive Mode
When enabled:
- All events route to a single FIFO queue (ignore priority)
- Feedback loop disabled (strategy frozen at "process everything")
- Workers pull FIFO
- Metrics still collected per tier for comparison

## Project Structure

```
jugaadflow/
├── main.py                 # Entry point
├── generator/
│   ├── sources.py          # Async source loops
│   ├── event.py            # Event dataclass
│   └── payloads.py         # Fake payload generators
├── pipeline/
│   ├── classifier.py       # Priority tagging + routing
│   ├── queues.py           # Queue creation + sizing
│   ├── overflow.py         # Overflow/defer/shed routing
│   ├── worker.py           # Worker loop
│   ├── strategy.py         # Strategy dataclass
│   └── decision_engine.py  # Feedback loop + levels
├── metrics/
│   └── store.py            # Metrics collection
├── dashboard/
│   ├── server.py           # FastAPI + WebSocket
│   └── static/
│       ├── index.html
│       ├── dashboard.js
│       └── style.css
├── benchmark/
│   └── naive.py            # Naive mode logic
├── requirements.txt
├── architecture.md
├── plan.md
└── CLAUDE.md
```

## Build Order

Build and test in this order. Each step should work before moving to the next:

1. **Event + Generator** — create events, push to input queue, verify rate control
2. **Classifier + Queues** — tag events, route to tier queues, verify distribution
3. **Workers (process only)** — pull from tier queues in priority order, record metrics
4. **Decision Engine** — feedback loop reads metrics, updates strategy, workers follow
5. **Batching** — workers handle batch mode per strategy
6. **Defer + Shed** — overflow routing, deferred queues, shed counters
7. **Backpressure** — implicit (queue blocking) + explicit (dashboard signal)
8. **Dashboard** — FastAPI server, WebSocket, Chart.js frontend
9. **Naive Mode** — toggle flag, single FIFO queue, benchmark comparison
10. **Integration** — tune thresholds, run full demo cycle, verify all metrics

## Critical Constraints (from problem statement)

- **Critical events must NEVER be silently dropped** — this is a hard constraint
- **Shedding must be visible** — logged and shown on dashboard, never silent
- **Report latency per priority tier** — not an aggregate average
- **Benchmark must show both conditions** — 1,000/min baseline AND 20,000/min spike
- **Be honest** — if something is simulated/mocked, say so
- **Same pipeline for both modes** — adaptive vs naive is a toggle, not separate code

## Common Pitfalls to Avoid

- Don't show aggregate average latency — always break by tier
- Don't timestamp events at queue entry — timestamp at creation (generator)
- Don't wait for batch to fill — take what's available, process immediately
- Don't use threads — stick to asyncio, all concurrency is cooperative
- Don't build a separate naive pipeline — it's a flag that disables intelligence
- Don't add Kafka/Redis/external infra — everything is in-memory
- Don't dynamically scale workers — 8 fixed workers is the constraint
- Don't defer tier 1 ever — backpressure is the only option for critical overflow
