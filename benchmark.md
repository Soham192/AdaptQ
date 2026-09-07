# JugaadFlow — Benchmark Report

## Test Setup

- **Machine:** [Your machine specs]
- **Workers:** 8 (fixed, same for both modes)
- **Baseline load:** ~1,000 events/min for 30 seconds
- **Spike load:** ~20,000 events/min for 60 seconds
- **Recovery:** ~1,000 events/min for 30 seconds
- **Event mix:** payments (4%), orders (9%), inventory (13%), clicks (28%), logs (46%)

## Results — Baseline Load (1,000 events/min)

Both modes perform identically under normal load.

| Metric | Adaptive | Naive |
|--------|----------|-------|
| Payment latency (avg) | — ms | — ms |
| Order latency (avg) | — ms | — ms |
| Click latency (avg) | — ms | — ms |
| Log latency (avg) | — ms | — ms |
| Events processed | — | — |
| Events shed | 0 | 0 |

## Results — Spike Load (20,000 events/min)

This is where the difference emerges.

| Metric | Adaptive | Naive |
|--------|----------|-------|
| **Payment latency (avg)** | **— ms** | **— ms** |
| **Order latency (avg)** | **— ms** | **— ms** |
| Click latency (avg) | — ms (or deferred) | — ms |
| Log latency (avg) | — ms (or shed) | — ms |
| Total events processed | — | — |
| Events batched | — | 0 |
| Events deferred | — | 0 |
| Events shed | — | 0 |
| **Payments shed** | **0** | **0** |
| Peak tier 1 queue depth | — | — |
| System survived | ✓ | ✗ (queue overflow / OOM) |

## Key Observations

### 1. Payment Latency Under Spike
_[Fill in: Adaptive kept payments at Xms while naive degraded to Yms — a Zx difference]_

### 2. Graceful Degradation
_[Fill in: Adaptive shed N logs and deferred M clicks, freeing capacity for critical events. Naive attempted to process everything and fell behind.]_

### 3. Recovery
_[Fill in: After spike ended, adaptive drained N deferred events in X seconds. Naive had a backlog of Y events that took Z seconds to clear.]_

### 4. Resource Usage
_[Fill in: Both used the same 8 workers. Adaptive handled the spike with zero additional compute. Naive would require ~Nx more workers to match adaptive's payment latency.]_

## Conclusion

The adaptive pipeline maintained critical event latency at — ms during a 20x spike while the naive pipeline degraded to — ms. Zero payments were dropped in either mode, but the naive pipeline's payment latency made it effectively unusable during the spike.

The adaptive approach achieved this with **zero additional compute** — same 8 workers, same machine, same resources. The only difference was intelligence: knowing what to prioritize, what to batch, what to defer, and what to shed.

**Cost implication:** To match adaptive pipeline performance, the naive approach would need approximately —x more workers, representing —x more infrastructure cost during spike periods.
