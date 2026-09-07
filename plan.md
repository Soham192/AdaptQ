# JugaadFlow — Project Plan

## One-Line Pitch
When the spike hits, our pipeline doesn't panic — it does jugaad. Same 8 workers, 20x traffic, zero additional compute.

## Problem Statement
Build an intelligent data pipeline that survives a 20x traffic spike not by adding more resources, but by making smarter decisions — what to process now, what to batch, what to defer, and what to drop — provably, without ever silently losing critical data.

## Use Case
An e-commerce platform receiving a mixed event stream: orders, payments, inventory updates, user activity (clicks/views), and application logs.
- **Normal load:** ~1,000 events/min
- **Flash sale spike:** ~20,000 events/min — 20x surge, arriving suddenly, not gradually

## Core Philosophy
The pipeline treats **not all events as equal**. A payment failing to process is a business problem. A log line arriving 30 seconds late is fine. The pipeline's intelligence comes from recognizing and acting on this difference.

---

## Components to Build (MVP — 30 hours)

### 1. Event Generator
**What:** Simulated e-commerce event producer with live-adjustable rate.
**Decisions made:**
- Same process as the pipeline (no separate service)
- Pushes into in-memory queue (provides natural backpressure)
- Dashboard button to trigger spike (keyboard shortcut as fallback)
**Event types and distribution:**
- Payment (~4%) — Tier 1
- Order (~9%) — Tier 1
- Inventory update (~13%) — Tier 2
- User activity / clicks (~28%) — Tier 3
- Application logs (~46%) — Tier 4
**Key details:**
- Weighted random distribution, ratios stay same during spike
- Each event timestamped at creation (for end-to-end latency measurement)
- Burstiness via random jitter on per-tick count
- Multiple async source loops for realistic multi-source ingestion
- Fake but realistic payloads (amounts, order IDs, customer IDs, log levels)
**Time estimate:** 1–2 hours

### 2. Classifier
**What:** Tags each event with a priority tier on arrival.
**Decision made:**
- Static lookup (hardcoded mapping, not dynamic rules)
**Mapping:**
```
payment  → Tier 1 (critical, never dropped)
order    → Tier 1
inventory → Tier 2 (important, can defer under pressure)
click    → Tier 3 (useful, can defer/shed)
log      → Tier 4 (noise, can shed freely)
```
**Time estimate:** 15 minutes

### 3. Priority Queues
**What:** Tier-separated queues so events are naturally isolated by priority.
**Decisions made:**
- Multiple queues (one per tier), NOT a single priority queue
- Different size limits per tier:
  - Tier 1: unlimited (maxsize=0) — never drop critical
  - Tier 2: capped (e.g., 5000)
  - Tier 3: smaller cap (e.g., 2000)
  - Tier 4: smallest cap (e.g., 500) — fills fast, triggers shedding
- Tier-specific deferred queues (Option B):
  - Deferred Tier 2 queue (capped)
  - Deferred Tier 3 queue (capped)
  - Tier 4 does NOT defer — sheds immediately
**Overflow ladder per tier:**
```
Tier 1 full → wait (backpressure, never lose)
Tier 2 full → deferred tier 2 queue → shed if deferred also full
Tier 3 full → deferred tier 3 queue → shed if deferred also full
Tier 4 full → shed immediately
```
**Time estimate:** 1 hour

### 4. Decision Engine + Feedback Loop
**What:** The brain. Sets the current strategy for how each tier should be handled. Runs a feedback loop that reads system metrics and adjusts strategy.
**Decisions made:**
- Level-based escalation (4 levels: Normal → Elevated → Critical → Emergency)
- Metrics monitored: tier 1 queue depth, tier 1 latency, worker utilization, incoming rate
- Feedback loop interval: every 3 seconds
- Fast escalation, slow de-escalation (one level at a time, 6-second cooldown)

**Escalation levels:**
```
Level 0 — Normal:
  All tiers: process individually

Level 1 — Elevated:
  Tier 1: process
  Tier 2: process
  Tier 3: batch (groups of 50)
  Tier 4: batch (groups of 100)

Level 2 — Critical:
  Tier 1: process
  Tier 2: batch (groups of 20)
  Tier 3: defer
  Tier 4: shed (sample 1 in 10)

Level 3 — Emergency:
  Tier 1: process + backpressure if needed
  Tier 2: defer
  Tier 3: defer
  Tier 4: shed (sample 1 in 20)
```

**Escalation triggers:**
```
Normal → Elevated:     tier 1 latency > 80ms OR tier 1 queue > 100
Elevated → Critical:   tier 1 latency > 150ms OR tier 1 queue > 500
Critical → Emergency:  tier 1 latency > 300ms OR tier 1 queue > 1000
```

**De-escalation triggers (must sustain for 6 seconds):**
```
Emergency → Critical:  tier 1 latency < 100ms AND tier 1 queue < 200
Critical → Elevated:   tier 1 latency < 60ms AND tier 1 queue < 50
Elevated → Normal:     tier 1 latency < 40ms AND tier 1 queue < 10
```

**Time estimate:** 3–4 hours

### 5. Workers
**What:** Async functions that pull from queues and execute actions.
**Decisions made:**
- 8–10 fixed workers (hardcoded, no dynamic scaling)
- Strict priority checking (always tier 1 first, then 2, 3, 4, then deferred)
- Variable simulated processing time by event type:
  - payment: 50ms
  - order: 40ms
  - inventory: 20ms
  - click: 10ms
  - log: 5ms
**Worker pull order:**
```
1. Tier 1 queue (always process)
2. Tier 2 queue (if not deferred by strategy)
3. Tier 3 queue (process/batch per strategy)
4. Tier 4 queue (process/batch/shed per strategy)
5. Deferred Tier 2 (if strategy.drain_deferred)
6. Deferred Tier 3 (if strategy.drain_deferred)
7. Nothing → sleep 10ms
```
**Metrics recorded per event:**
- End-to-end latency (completion time - creation timestamp)
- Processed count per type
- Throughput per tier per time window
- Shed count per type
- Deferred count per type
- Batched count per type
**Time estimate:** 2–3 hours

### 6. Backpressure Mechanism
**What:** Last safety net for tier 1. Slows the source instead of dropping critical events.
**Decisions made:**
- Both implicit (queue blocking) AND explicit (visible signal on dashboard)
- Slow release with cooldown (same pattern as de-escalation)
**How it works:**
- Implicit: tier 1 queue maxsize=0 but upstream input queue has a cap. When input queue fills, generator's `put()` blocks naturally.
- Explicit: when tier 1 queue depth crosses 80% of a soft threshold, log "backpressure applied" and show on dashboard.
**Time estimate:** 1 hour

### 7. Dashboard
**What:** Live real-time dashboard showing all metrics per tier.
**Decisions made:**
- WebSocket for live data push (HTTP polling as fallback)
- FastAPI as the server (integrates with asyncio, same process)
- Chart.js for frontend charts
**Dashboard contents:**
- Current escalation level (Normal/Elevated/Critical/Emergency) with color
- Queue depths per tier (bar/numbers)
- Latency per tier (numbers + line chart over time)
- Throughput per tier (events/sec)
- Shed/Defer/Batch counters (running totals)
- "Payments shed: 0 ✓" — the proof line
- Latency over time line chart (per tier — THE key visual)
- Events/sec over time line chart
- Backpressure status (Active/Inactive)
- Spike trigger button
- Adaptive/Naive mode toggle
**Time estimate:** 4–5 hours

### 8. Naive Mode Toggle
**What:** Flag that disables all intelligence for benchmark comparison.
**Decision made:**
- A flag inside the decision engine, NOT a separate codebase
**What naive mode does:**
- Disables feedback loop
- Routes ALL events into one shared FIFO queue (no tier separation)
- Workers pull FIFO (payment waits behind 500 logs)
- No batching, no deferring, no shedding
- Classifier still tags events (so per-tier latency can be measured for comparison)
**Time estimate:** 30 minutes

### 9. Architecture Diagram
**What:** Visual showing the full event flow.
**Flow:** Sources → Ingestion → Classifier → Priority-aware tier queues → Decision engine + Feedback loop → Workers → Sink
**Time estimate:** 30 minutes

---

## Stretch Goals (ONLY after MVP is solid)
1. **Fault tolerance with idempotent retry** — kill a worker mid-process, retry only what failed, no duplicate side effects
2. **Dynamic worker scaling** — spin up/down workers based on queue depth
3. **Redundant/duplicate event detection** — detect and skip duplicate events from upstream retries
4. **Formalized decision function** — `ProcessingDecision = f(priority, queueSize, latency, workerLoad, dataSize, processingCost)` as a scored/weighted function replacing the level-based if-else
5. **Cost estimation** — model infrastructure cost per strategy and show adaptive approach is cheaper than naive scale-up

---

## Deliverables
1. Working prototype (code repo) with setup instructions
2. Architecture diagram (sources → ingestion → priority queue/broker → adaptive processing → sink)
3. Benchmark report comparing adaptive pipeline vs naive fixed-strategy baseline
4. 5-minute live demo: normal load → trigger 20x spike → dashboard shows payments staying fast, clicks degrading, shed counters climbing → spike ends → recovery

---

## Demo Script (5 minutes)

**Minute 0–1:** Start pipeline. Show dashboard at normal load. All green, all tiers processing, queues empty, latency low.

**Minute 1–2:** Explain the architecture briefly. Point out the four tier queues, the decision engine level (Normal), the zero shed counters.

**Minute 2–3:** Press the SPIKE button. Watch the dashboard react:
- Level jumps: Normal → Elevated → Critical
- Click queue grows, then flatlines (deferred)
- Log shed counter starts climbing
- Payment latency stays flat (THE money shot)
- Throughput chart shows incoming spike, processed staying steady

**Minute 3–4:** Point out key metrics:
- "Payments: 42ms latency, zero dropped"
- "Logs: 600 shed, sampled at 10%"
- "Clicks: 1,800 deferred, will process after spike"
- "System level: Critical — automatically escalated"

**Minute 4–5:** Spike ends. Watch recovery:
- Level gradually drops: Critical → Elevated → Normal
- Deferred queues drain
- All metrics normalize
- Show final benchmark: adaptive vs naive side by side

---

## Tech Stack
- **Language:** Python 3.11+ with asyncio
- **Web framework:** FastAPI (dashboard server + WebSocket)
- **Frontend:** HTML + Chart.js (live updating charts)
- **Concurrency:** asyncio (single thread, cooperative multitasking)
- **No external infrastructure:** No Kafka, no Redis, no databases. All in-memory, all simulated.

---

## Time Budget (30 hours)

| Component | Hours |
|---|---|
| Event generator | 1.5 |
| Classifier | 0.5 |
| Priority queues + overflow logic | 1.5 |
| Decision engine + feedback loop | 4 |
| Workers | 3 |
| Backpressure | 1 |
| Dashboard (backend) | 2 |
| Dashboard (frontend) | 3 |
| Naive mode | 0.5 |
| Architecture diagram | 0.5 |
| Integration + testing | 4 |
| Tuning thresholds | 2 |
| Benchmark report | 1.5 |
| Demo rehearsal | 1 |
| Buffer | 4 |
| **Total** | **30** |
