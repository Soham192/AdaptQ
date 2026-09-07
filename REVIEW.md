# JugaadFlow — Code Review Fix List (Round 3)

Read this file, then apply all fixes in order. Start with MUST FIX, then SHOULD FIX, then NICE TO FIX, then STILL NEEDED.

**Previously fixed (confirmed):** source intervals match architecture.md, main.py exists, worker.py tier guards cleaned up, backpressure detection added to decision_engine, metrics enhanced with classified_window/recent_events/recent_decisions, dashboard enhanced with queue bars + classification chart + rate presets.

---

## MUST FIX (correctness bugs)

### 1. decision_engine.py — de-escalation STILL ignores tier 1 latency

File: `jugaadflow/pipeline/decision_engine.py`, function `_check_deescalation()` (line 58)

The spec requires BOTH latency AND queue depth for de-escalation:
```
Emergency→Critical: t1_latency < 100ms AND t1_queue < 200
Critical→Elevated:  t1_latency < 60ms  AND t1_queue < 50
Elevated→Normal:    t1_latency < 40ms  AND t1_queue < 10
```

The function signature doesn't even accept `t1_latency_ms`. It only checks `t1_queue` and `lower_q_shrinking`. Without the latency check, the system de-escalates while tier 1 latency is still dangerously high, then immediately re-escalates (flapping).

Fix — change the signature and add latency checks:
```python
def _check_deescalation(t1_latency_ms: float, t1_queue: int, lower_q: int, lower_q_shrinking: bool, current_level: int) -> int | None:
    if current_level == 3 and t1_latency_ms < 100 and t1_queue < 10 and lower_q_shrinking:
        return 2
    if current_level == 2 and t1_latency_ms < 60 and t1_queue < 5 and lower_q_shrinking:
        return 1
    if current_level == 1 and t1_latency_ms < 40 and t1_queue < 5 and lower_q < 20:
        return 0
    return None
```

Also update the call site on line 113 to pass `t1_latency_ms`:
```python
de_target = _check_deescalation(t1_latency_ms, t1_queue, lower_q, lower_q_shrinking, strategy.level)
```

### 2. server.py — clients.remove(ws) can raise ValueError

File: `jugaadflow/dashboard/server.py`, line 59

Race between `metrics_broadcaster` removing dead clients (lines 165-167) and the `WebSocketDisconnect` handler. If broadcaster removes the client first, `remove()` throws `ValueError`.

Fix:
```python
except WebSocketDisconnect:
    if ws in clients:
        clients.remove(ws)
```

### 3. decision_engine.py — batch sizes deviate from spec

File: `jugaadflow/pipeline/decision_engine.py`, `LEVEL_STRATEGIES` (lines 13-26)
Also: `jugaadflow/pipeline/strategy.py`, default `batch_sizes` (line 10)

The spec (CLAUDE.md + architecture.md) says:
```
Level 1: tier3 batch(50), tier4 batch(100)
Level 2: tier2 batch(20)
```

The code has `{"tier2": 5, "tier3": 10, "tier4": 20}` — 4-5x smaller than spec. Smaller batches mean less throughput benefit from batching. At 20x spike, workers batch 10-20 events instead of 50-100.

Fix — update all four LEVEL_STRATEGIES entries and the Strategy default:

In `decision_engine.py`:
```python
LEVEL_STRATEGIES = {
    0: {... "batch_sizes": {"tier2": 20, "tier3": 50, "tier4": 100}, ...},
    1: {... "batch_sizes": {"tier2": 20, "tier3": 50, "tier4": 100}, ...},
    2: {... "batch_sizes": {"tier2": 20, "tier3": 50, "tier4": 100}, ...},
    3: {... "batch_sizes": {"tier2": 20, "tier3": 50, "tier4": 100}, ...},
}
```

In `strategy.py`:
```python
batch_sizes: dict = field(default_factory=lambda: {"tier2": 20, "tier3": 50, "tier4": 100})
```

If the smaller sizes were intentional tuning, document why and update the spec.

---

## SHOULD FIX (affects demo quality)

### 4. server.py — avg_latency_ms() called twice per tier

File: `jugaadflow/dashboard/server.py`, lines 128-131

Each `avg_latency_ms()` iterates 500 deque elements. Called 2x per tier x 4 tiers = 8 wasted iterations every second.

Fix:
```python
latency = {}
for t in range(1, 5):
    ms = metrics.avg_latency_ms(t)
    latency[f"tier{t}"] = round(ms, 1) if ms is not None else None
```
Then use the `latency` dict in the return payload.

### 5. dashboard.js — null latency renders as 0ms on chart

File: `jugaadflow/dashboard/static/dashboard.js`, lines 164-169

`data.latency_ms.tier1 || 0` makes "no data" look like "0ms = instant" on the chart when a tier is deferred and has no samples.

Fix:
```javascript
pushChartData(latencyChart, label, [
    data.latency_ms.tier1,
    data.latency_ms.tier2,
    data.latency_ms.tier3,
    data.latency_ms.tier4,
]);
```
And add `spanGaps: false` to each latency dataset in `initCharts()`.

### 6. classifier.py — incoming_rate never updated

File: `jugaadflow/pipeline/classifier.py`, function `classifier_loop()` (line 37)

`metrics.incoming_rate` is always 0.0. Dashboard always shows 0.

Fix — add rate tracking:
```python
async def classifier_loop(queues, metrics, strategy=None):
    if strategy is None:
        strategy = Strategy()
    count = 0
    window_start = time.time()
    while True:
        event = await queues.input_queue.get()
        await classify_and_route(event, queues, metrics, strategy)
        count += 1
        now = time.time()
        if now - window_start >= 1.0:
            metrics.incoming_rate = count / (now - window_start)
            count = 0
            window_start = now
```

### 7. classifier.py — strategy-aware routing was removed, stale events accumulate

File: `jugaadflow/pipeline/classifier.py`, function `classify_and_route()` (line 19)

The previous version intercepted "defer" strategies and routed directly to deferred queues. That was removed. Now when `strategy.tier3 == "defer"`, the classifier still fills the tier 3 queue to maxsize=2000 before overflow kicks in. Workers skip the tier 3 queue (strategy says defer), so those 2000 events sit idle with growing latency. When strategy changes back, they all get processed with massive latency spikes.

Fix — re-add strategy-aware routing:
```python
TIER_STRATEGY_KEY = {2: "tier2", 3: "tier3", 4: "tier4"}

async def classify_and_route(event, queues, metrics, strategy):
    event.priority = PRIORITY_MAP[event.type]
    metrics.record_classified(event.priority)

    strat_key = TIER_STRATEGY_KEY.get(event.priority)
    if strat_key and getattr(strategy, strat_key) == "defer":
        deferred = queues.deferred(event.priority)
        if deferred is not None:
            try:
                deferred.put_nowait(event)
                metrics.deferred_count[event.type] += 1
                _log_event(metrics, event, f"deferred_tier{event.priority}", "defer")
                return
            except asyncio.QueueFull:
                metrics.shed_count[event.type] += 1
                _log_event(metrics, event, "shed", "shed")
                return

    await route_to_queue(event, queues, metrics)
```

### 8. test_decision_engine.py — hardcoded True in "stayed NORMAL" check

File: `tests/test_decision_engine.py`, line 77

`'PASS' if True else 'FAIL'` always passes.

Fix — capture level after Phase 1:
```python
# After Phase 1 sleep (line 54):
normal_level = strategy.level

# In summary (line 77):
print(f"  Normal -> stayed NORMAL: {'PASS' if normal_level == 0 else 'FAIL'}")
```

### 9. test_defer_shed.py — 15s recovery too short

File: `tests/test_defer_shed.py`, line 69

De-escalation from Emergency→Normal takes 18s minimum (6s cooldown x 3 level steps). Deferred drain only starts at Level 0 (or Level 1 with the current code). 15s may not be enough.

Fix:
```python
await asyncio.sleep(25.0)
```

### 10. test_generator.py — rate check bounds wrong for new base rate

File: `tests/test_generator.py`, line 127

`rate_ok = 500 < rate_per_min_normal < 3000` — but with the architecture.md intervals, the normal rate is ~3400/min. This check will FAIL every time.

Fix:
```python
rate_ok = 2000 < rate_per_min_normal < 5000
```

### 11. dashboard.js — mode toggle desyncs on refresh

File: `jugaadflow/dashboard/static/dashboard.js` and `jugaadflow/dashboard/server.py`

`currentMode` is local JS state. On page refresh it resets to 'adaptive'.

Fix — in `server.py` `build_metrics_payload()`, add:
```python
"naive_mode": app.state.naive_mode,
```
You'll need to pass `app` to `build_metrics_payload()` or store the reference. Then in `dashboard.js` `handleMessage()`, add:
```javascript
if (data.naive_mode !== undefined) {
    currentMode = data.naive_mode ? 'naive' : 'adaptive';
    document.getElementById('modeBtn').textContent = 'Mode: ' + (data.naive_mode ? 'Naive' : 'Adaptive');
}
```

---

## NICE TO FIX (code quality)

### 12. event.py — unnecessary threading.Lock

File: `jugaadflow/generator/event.py`, lines 2, 7-8, 10-14

Asyncio is single-threaded. The lock is never contested. CLAUDE.md says "Don't use threads."

Fix:
```python
import time
from dataclasses import dataclass, field

_counter = 0

def _next_id() -> str:
    global _counter
    _counter += 1
    return f"evt-{_counter:05d}"
```

### 13. classifier.py — dead code `_log_event()`

File: `jugaadflow/pipeline/classifier.py`, lines 25-34

`_log_event()` is defined but never called in this file. The active copy lives in `overflow.py`. Remove the dead copy from classifier.py.

### 14. style.css + dashboard.js — canvas sizing conflict

File: `jugaadflow/dashboard/static/style.css` line 45, `jugaadflow/dashboard/static/dashboard.js`

`!important` on canvas width/height overrides Chart.js responsive behavior.

Fix — in `dashboard.js`, add to `sharedOpts`:
```javascript
maintainAspectRatio: false,
```

### 15. test_batching.py — weak assertions

File: `tests/test_batching.py`, lines 64-66

Only checks `total_batched_spike > 0`. Doesn't verify which types were batched.

Fix — add:
```python
click_or_log_batched = batched_spike.get('click', 0) + batched_spike.get('log', 0) > 0
print(f"  Click/log batched:   {'PASS' if click_or_log_batched else 'FAIL'}")
print(f"  Payment NOT batched: {'PASS' if batched_spike.get('payment', 0) == 0 else 'FAIL'}")
```

### 16. decision_engine.py — escalation lower_q thresholds are very aggressive

File: `jugaadflow/pipeline/decision_engine.py`, `_check_escalation()` (lines 48-55)

Escalation triggers include `lower_q > 50/200/500`. These are much tighter than the previous values (200/1000/3000) and not in the spec at all. With the ~3400/min base rate, lower queues will fluctuate and could trigger unnecessary escalation during normal load.

If the `lower_q` triggers are intentional (an improvement over spec), document them. Otherwise, remove them and rely only on t1_latency and t1_queue per spec:
```python
def _check_escalation(t1_latency_ms, t1_queue, current_level):
    if current_level < 3 and (t1_latency_ms > 300 or t1_queue > 1000):
        return 3
    if current_level < 2 and (t1_latency_ms > 150 or t1_queue > 500):
        return 2
    if current_level < 1 and (t1_latency_ms > 80 or t1_queue > 100):
        return 1
    return None
```

---

## STILL NEEDED (not yet built)

### 17. Naive mode wiring

`app.state.naive_mode` is set by the dashboard toggle but nothing reads it. Need a mechanism to swap between adaptive and naive. The naive functions exist in `jugaadflow/benchmark/naive.py`.

### 18. plan.md — fix shed rate discrepancy

File: `plan.md`

Level 2 says "shed (sample 1 in 5)" (20% kept). CLAUDE.md and the code both say 10%. Update plan.md.

---

## Verification

After all fixes, run every test:
```bash
cd /home/soham/Downloads/VH26-Hackaholics
python tests/test_generator.py
python tests/test_classifier.py
python tests/test_workers.py
python tests/test_decision_engine.py
python tests/test_batching.py
python tests/test_defer_shed.py
```

Then run the full pipeline:
```bash
python jugaadflow/main.py
```
Open http://localhost:8000 and verify:
- Dashboard loads, WebSocket connects, charts update
- Click rate presets — queue depths and level should respond
- At 68K/min (20x): level should escalate, shed counter should climb for logs, payment shed stays 0
- Return to 3.4K/min: level should de-escalate smoothly (no flapping), deferred queues should drain

Key assertions across all tests:
- `Payment never shed: PASS`
- `test_decision_engine`: escalates during spike AND de-escalates during recovery
- `test_generator`: rate bounds pass with updated thresholds
- `test_defer_shed`: deferred queues drain during recovery (with longer sleep)
