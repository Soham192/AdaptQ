import asyncio
import logging
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

logging.basicConfig(level=logging.INFO, format="  [%(name)s] %(message)s")

from jugaadflow.generator.sources import ALL_SOURCES
from jugaadflow.pipeline.queues import create_queues
from jugaadflow.pipeline.classifier import classifier_loop
from jugaadflow.pipeline.strategy import Strategy
from jugaadflow.pipeline.worker import worker
from jugaadflow.pipeline.decision_engine import feedback_loop, LEVEL_NAMES
from jugaadflow.metrics.store import Metrics

NUM_WORKERS = 8


async def monitor(strategy, metrics, queues, stop_event):
    while not stop_event.is_set():
        t1_lat = metrics.avg_latency_ms(1)
        t1_q = queues.tier1.qsize()
        print(
            f"  [monitor] level={LEVEL_NAMES[strategy.level]} "
            f"t1_lat={t1_lat:.1f}ms t1_q={t1_q} "
            f"t2_q={queues.tier2.qsize()} t3_q={queues.tier3.qsize()} t4_q={queues.tier4.qsize()} "
            f"strategy: t2={strategy.tier2} t3={strategy.tier3} t4={strategy.tier4}"
        ) if t1_lat is not None else None
        await asyncio.sleep(2.0)


async def run_test():
    queues = create_queues()
    strategy = Strategy()
    metrics = Metrics()
    rate_multiplier = [1.0]

    print("=" * 60)
    print("JugaadFlow Decision Engine Test")
    print("=" * 60)

    source_tasks = [asyncio.create_task(src(queues.input_queue, rate_multiplier)) for src in ALL_SOURCES]
    classifier_task = asyncio.create_task(classifier_loop(queues, metrics, strategy))
    worker_tasks = [asyncio.create_task(worker(i, queues, strategy, metrics)) for i in range(NUM_WORKERS)]
    feedback_task = asyncio.create_task(feedback_loop(queues, strategy, metrics, interval=1.0))

    stop = asyncio.Event()
    monitor_task = asyncio.create_task(monitor(strategy, metrics, queues, stop))

    print("\n--- Phase 1: Normal rate for 5s ---")
    await asyncio.sleep(5.0)
    normal_level = strategy.level
    print(f"\n  Level after normal: {LEVEL_NAMES[strategy.level]} (expected NORMAL)")

    print("\n--- Phase 2: Spike 20x for 10s ---")
    rate_multiplier[0] = 20.0
    await asyncio.sleep(10.0)
    spike_level = strategy.level
    print(f"\n  Level after spike: {LEVEL_NAMES[spike_level]} (expected ELEVATED or higher)")

    print("\n--- Phase 3: Recovery for 15s ---")
    rate_multiplier[0] = 1.0
    await asyncio.sleep(15.0)
    recovery_level = strategy.level
    print(f"\n  Level after recovery: {LEVEL_NAMES[recovery_level]} (expected NORMAL)")

    stop.set()
    for t in source_tasks + [classifier_task, feedback_task, monitor_task] + worker_tasks:
        t.cancel()

    await asyncio.sleep(0.1)

    print(f"\n  Payment shed count: {metrics.shed_count['payment']} (must be 0)")
    print(f"\n{'=' * 60}")
    print("SUMMARY")
    print(f"  Normal → stayed NORMAL: {'PASS' if normal_level == 0 else 'FAIL'}")
    print(f"  Spike → escalated:      {'PASS' if spike_level > 0 else 'FAIL'}")
    print(f"  Recovery → de-escalated: {'PASS' if recovery_level < spike_level else 'CHECK'}")
    print(f"  Payment never shed:      {'PASS' if metrics.shed_count['payment'] == 0 else 'FAIL'}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(run_test())
