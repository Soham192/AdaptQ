# AdaptQ

**An intelligent adaptive data pipeline that survives 20x traffic spikes using fixed resources — by making smarter decisions, not adding more machines.**

Built for **UCET 2026 Hack-o-thon** | Domain: Application Building — Pipelines/Processing

![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=black)
![Gemini](https://img.shields.io/badge/Gemini_AI-4285F4?logo=google&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)

---

## The Problem

A naive pipeline treats every event identically. When traffic spikes 20x, critical payment events sit behind thousands of log lines — latency explodes, and business-critical operations fail. The typical fix is to throw more machines at it, but that's slow, expensive, and doesn't solve the root issue.

## Our Solution

AdaptQ uses **8 fixed workers** (no auto-scaling) and makes **intelligent per-event decisions** based on priority and real-time system state:

| Decision | When | Example |
|----------|------|---------|
| **Process** | Always for critical events | Payments, orders |
| **Batch** | Moderate load | Group clicks, process together |
| **Defer** | Heavy load | Park inventory updates for later |
| **Shed** | Extreme load | Drop logs with visible counter |

**Hard guarantee:** Critical events (payments, orders) are **never** silently dropped — the pipeline uses backpressure, not shedding, when critical queues overflow.

---

## Architecture

```
Generator --> Input Queue --> Classifier --> Tier Queues (1-4) --> Workers (8) --> Sink
                                                | overflow
                                           Deferred Queues --> Workers (during recovery)
                                                | overflow
                                           Shed (counter only)

AI Agents:     Optimizer (tunes thresholds) + Evaluator (validates changes)
Feedback Loop: Reads metrics every 3s --> Updates strategy --> Workers follow
Escalation:    Twilio voice call to on-call operator when AI can't resolve
Dashboard:     FastAPI + WebSocket --> React + Chart.js (real-time)
```

### Priority Tiers

| Tier | Event Types | Queue Cap | Overflow Behavior |
|------|------------|-----------|-------------------|
| 1 (Critical) | payment, order | Unlimited | Backpressure (blocks) |
| 2 (Important) | inventory | 5,000 | Defer --> Shed if full |
| 3 (Useful) | click | 2,000 | Defer --> Shed if full |
| 4 (Noise) | log | 500 | Shed immediately |

### Escalation Levels

| Level | Tier 2 | Tier 3 | Tier 4 | Trigger |
|-------|--------|--------|--------|---------|
| Normal | Process | Process | Process | Default |
| Elevated | Process | Batch | Batch | T1 latency >80ms or queue >100 |
| Critical | Batch | Defer | Shed 10% | T1 latency >150ms or queue >500 |
| Emergency | Defer | Defer | Shed 5% | T1 latency >300ms or queue >1000 |

---

## Features

- **Priority-based 4-tier queue system** with separate deferred queues per tier
- **AI-powered optimization** — Gemini agents auto-tune pipeline thresholds in real-time
- **AI evaluator** — validates optimizer changes, auto-reverts if metrics worsen
- **Human escalation** — Twilio voice calls to on-call operator with conversational AI
- **Live dashboard** — WebSocket-powered real-time metrics with Chart.js visualizations
- **Naive vs Adaptive benchmark** — toggle to compare FIFO vs intelligent routing
- **Fault tolerance** — retry with exponential backoff, dead-letter queue, idempotency checks
- **Deduplication** — content-hash based duplicate detection
- **Chaos controls** — kill workers, flood queues, inject event spikes from the dashboard

---

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 18+ (for frontend build)

### Run Locally

```bash
# Clone
git clone https://github.com/Soham192/AdaptQ.git
cd AdaptQ

# Install Python dependencies
pip install -r requirements.txt

# Install and build frontend
cd frontend && npm install && npm run build && cd ..

# Set up environment (optional — pipeline works without these)
cp .env.example .env
# Add your GEMINI_API_KEY for AI agents
# Add Twilio credentials for voice escalation

# Run
python -m jugaadflow.main

# Open http://localhost:8000
```

### Run with Docker

```bash
docker build -t adaptq .
docker run -p 8000:8000 --env-file .env adaptq
```

---

## Demo Walkthrough

1. Open the dashboard at `http://localhost:8000`
2. Observe **normal load** (~3,400 events/min) — all metrics green
3. Drag the **traffic slider** to 20x or click event spike buttons
4. Watch the pipeline adapt in real-time:
   - Escalation level climbs: Normal --> Elevated --> Critical --> Emergency
   - Payment latency stays flat (~42ms)
   - Lower-priority queues fill, then stabilize via defer/shed
   - Shed counters climb — but **Payments shed: 0 always**
5. Reduce traffic — system de-escalates gradually, deferred events drain
6. Toggle **Naive Mode** to compare — watch payment latency explode to 3000ms+

---

## Adaptive vs Naive Benchmark

| Metric | Adaptive | Naive |
|--------|----------|-------|
| Payment latency (during spike) | ~42ms | ~3,200ms |
| Payment events dropped | 0 | 0 (but severely delayed) |
| System behavior | Graceful degradation | Queue explosion |
| Recovery time | Seconds | Minutes |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Python 3.11+ / asyncio (single thread, cooperative concurrency) |
| API & WebSocket | FastAPI + uvicorn |
| Frontend | React + Vite + Tailwind CSS + Chart.js |
| AI Agents | Google Gemini 3.6 Flash (REST API) |
| Voice Escalation | Twilio Programmable Voice + TwiML |
| Deployment | Docker + Render |

**Zero external infrastructure** — no Kafka, no Redis, no databases. Everything runs in-memory in a single process.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | No | Enables AI optimizer + evaluator agents |
| `JUGAADFLOW_AGENT_MODEL` | No | Gemini model name (default: `gemini-3.6-flash`) |
| `TWILIO_ACCOUNT_SID` | No | Enables voice escalation calls |
| `TWILIO_API_KEY_SID` | No | Twilio API key |
| `TWILIO_API_KEY_SECRET` | No | Twilio API secret |
| `TWILIO_FROM_NUMBER` | No | Twilio phone number to call from |
| `ALERT_PHONE_NUMBER` | No | On-call operator's phone number |
| `PORT` | No | Server port (default: 8000) |

The pipeline runs fully without any API keys — AI agents and voice escalation are optional enhancements.

---

## Project Structure

```
AdaptQ/
├── jugaadflow/
│   ├── main.py                 # Entry point — asyncio.gather all components
│   ├── generator/
│   │   ├── sources.py          # Async event source loops
│   │   ├── event.py            # Event dataclass
│   │   └── payloads.py         # Fake payload generators
│   ├── pipeline/
│   │   ├── classifier.py       # Priority tagging + queue routing
│   │   ├── queues.py           # Queue creation + sizing
│   │   ├── overflow.py         # Overflow/defer/shed routing
│   │   ├── worker.py           # Worker loop + process/batch/shed
│   │   ├── strategy.py         # Strategy dataclass
│   │   ├── decision_engine.py  # Feedback loop + escalation levels
│   │   ├── thresholds.py       # Tunable threshold parameters
│   │   └── dedup.py            # Content-hash deduplication
│   ├── agents/
│   │   ├── __init__.py         # Gemini LLM client
│   │   ├── optimizer.py        # AI threshold optimizer
│   │   ├── evaluator.py        # AI change evaluator
│   │   ├── escalation.py       # Human escalation (Twilio voice)
│   │   └── state.py            # Agent state management
│   ├── metrics/
│   │   └── store.py            # Metrics collection + rolling windows
│   ├── dashboard/
│   │   ├── server.py           # FastAPI + WebSocket + API endpoints
│   │   └── static/             # Legacy static dashboard
│   └── benchmark/
│       └── naive.py            # Naive mode logic
├── frontend/                   # React + Vite dashboard
│   ├── src/
│   │   ├── App.jsx             # Main dashboard UI
│   │   └── styles.css          # Tailwind styles
│   └── vite.config.js
├── tests/                      # Test suite
├── Dockerfile                  # Multi-stage Docker build
├── render.yaml                 # Render deployment blueprint
├── architecture.md             # Detailed architecture docs
└── requirements.txt
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `WS` | `/ws` | Real-time metrics stream (1s interval) |
| `POST` | `/api/spike` | Trigger 20x traffic spike |
| `POST` | `/api/normal` | Return to normal traffic |
| `POST` | `/api/rate` | Set custom event rate |
| `POST` | `/api/mode/naive` | Enable naive (FIFO) mode |
| `POST` | `/api/mode/adaptive` | Enable adaptive mode |
| `POST` | `/api/event-spike` | Inject burst of specific event type |
| `POST` | `/api/flood` | Flood all tier queues simultaneously |
| `POST` | `/api/kill-worker` | Simulate worker failure |
| `POST` | `/api/reset` | Reset all metrics and counters |
| `POST` | `/api/agents/trigger` | Manually trigger AI optimizer |
| `POST` | `/api/alerts/test-call` | Test escalation voice call |

---

## Team

**Team:** Hackaholics  
**Event:** UCET 2026 Hack-o-thon — Pixels to Possibilities  
**College:** Vidyavardhini's College of Engineering & Technology
