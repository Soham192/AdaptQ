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


async def run_test():
    queues = create_queues()
    strategy = Strategy()
    metrics = Metrics()
    rate_multiplier = [1.0]

    print("=" * 60)
    print("JugaadFlow Batching Test")
    print("=" * 60)

    source_tasks = [asyncio.create_task(src(queues.input_queue, rate_multiplier)) for src in ALL_SOURCES]
    classifier_task = asyncio.create_task(classifier_loop(queues, metrics, strategy))
    worker_tasks = [asyncio.create_task(worker(i, queues, strategy, metrics)) for i in range(NUM_WORKERS)]
    feedback_task = asyncio.create_task(feedback_loop(queues, strategy, metrics, interval=1.0))

    print("\n--- Phase 1: Normal for 3s (no batching expected) ---")
    await asyncio.sleep(3.0)
    batched_normal = dict(metrics.batched_count)
    total_batched_normal = sum(batched_normal.values())
    print(f"  Batched events: {total_batched_normal}")

    print("\n--- Phase 2: Spike 20x for 10s (batching expected at ELEVATED+) ---")
    rate_multiplier[0] = 20.0
    await asyncio.sleep(10.0)
    batched_spike = {k: metrics.batched_count[k] - batched_normal.get(k, 0) for k in metrics.batched_count}
    total_batched_spike = sum(batched_spike.values())
    print(f"  Level: {LEVEL_NAMES[strategy.level]}")
    print(f"  Batched during spike: {total_batched_spike}")
    print(f"  Batched by type:")
    for t in ["payment", "order", "inventory", "click", "log"]:
        print(f"    {t:12s}: {batched_spike.get(t, 0)}")

    print(f"\n  Processed total: {sum(metrics.processed_count.values())}")
    print(f"  Shed total: {sum(metrics.shed_count.values())}")

    rate_multiplier[0] = 1.0
    await asyncio.sleep(3.0)

    for t in source_tasks + [classifier_task, feedback_task] + worker_tasks:
        t.cancel()

    print(f"\n{'=' * 60}")
    print("SUMMARY")
    click_or_log_batched = batched_spike.get('click', 0) + batched_spike.get('log', 0) > 0
    print(f"  Batching occurred during spike: {'PASS' if total_batched_spike > 0 else 'FAIL'}")
    print(f"  Click/log batched:              {'PASS' if click_or_log_batched else 'FAIL'}")
    print(f"  Payment NOT batched:            {'PASS' if batched_spike.get('payment', 0) == 0 else 'FAIL'}")
    print(f"  Payment never shed:             {'PASS' if metrics.shed_count['payment'] == 0 else 'FAIL'}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(run_test())
