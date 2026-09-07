# JugaadFlow

**An intelligent adaptive data pipeline that survives 20x traffic spikes using fixed resources — by making smarter decisions, not adding more machines.**

Built for UCET 2026 Hack-o-thon | Domain: Application Building Pipelines/Processing

## The Problem

A naive pipeline treats a payment and a log line identically. When traffic spikes 20x, payments sit behind thousands of log lines, latency explodes, and critical business events fail. The brute-force fix — "add more workers" — is slow, expensive, and doesn't address the root issue.

## Our Approach

JugaadFlow uses **fixed resources** (8 workers, no scaling) and makes **intelligent per-event decisions** based on priority and real-time system state:

- **Process** — handle immediately, individually (payments always)
- **Batch** — group and handle efficiently (clicks under moderate load)
- **Defer** — park for later when load drops (clicks under heavy load)
- **Shed** — drop deliberately with a visible counter (logs under extreme load)

Critical events (payments, orders) are **never** silently dropped. The pipeline uses backpressure, not shedding, when critical queues overflow.

## Quick Start

```bash
# Clone and install
git clone <repo-url>
cd jugaadflow
pip install -r requirements.txt

# Run
python main.py

# Open dashboard
# Navigate to http://localhost:8000
```

## Demo

1. Open the dashboard at `http://localhost:8000`
2. Observe normal load (~1,000 events/min) — all metrics green
3. Click **SPIKE** — traffic jumps to ~20,000 events/min
4. Watch the pipeline adapt:
   - Escalation level changes (Normal → Elevated → Critical)
   - Payment latency stays flat
   - Click/log queues grow, then stabilize via deferring/shedding
   - Shed counters climb — but `Payments shed: 0` always
5. Spike ends — system de-escalates gradually, deferred events drain

## Key Metrics (Dashboard)

| Metric | What It Shows |
|--------|---------------|
| Queue Depth / Tier | How backed up each priority level is |
| Latency / Tier | Processing time per priority — NOT an aggregate average |
| Throughput / Tier | Events processed per second per priority |
| Shed/Defer/Batch Counts | Every decision visible, never silent |
| Current Level | System's escalation state (Normal → Emergency) |
| Backpressure | Whether the system is slowing the source |

## Benchmark: Adaptive vs Naive

Toggle **Naive Mode** on the dashboard to disable all intelligence. The pipeline processes everything FIFO with no priority, no batching, no shedding. Compare:

| Metric | Adaptive | Naive |
|--------|----------|-------|
| Payment latency (spike) | ~42ms | ~3,200ms |
| Payments dropped | 0 | 0 (but delayed) |
| System survival | Graceful degradation | Queue explosion |

## Architecture

```
Generator → Input Queue → Classifier → Tier Queues (1-4) → Workers (8) → Sink
                                            ↓ overflow
                                       Deferred Queues
                                            ↓ overflow
                                       Shed (counted)

Feedback Loop: reads metrics → sets strategy → workers follow
Dashboard: FastAPI + WebSocket → HTML + Chart.js
```

See `architecture.md` for full technical details.

## Tech Stack

- Python 3.11+ / asyncio
- FastAPI + WebSocket
- Chart.js
- Zero external infrastructure

## Team

**Team:** [Your team name]
**Event:** UCET 2026 Hack-o-thon — Pixels to Possibilities
**College:** Vidyavardhini's College of Engineering & Technology
