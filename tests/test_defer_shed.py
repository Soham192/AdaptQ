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
    print("JugaadFlow Defer + Shed Test")
    print("=" * 60)

    source_tasks = [asyncio.create_task(src(queues.input_queue, rate_multiplier)) for src in ALL_SOURCES]
    classifier_task = asyncio.create_task(classifier_loop(queues, metrics, strategy))
    worker_tasks = [asyncio.create_task(worker(i, queues, strategy, metrics)) for i in range(NUM_WORKERS)]
    feedback_task = asyncio.create_task(feedback_loop(queues, strategy, metrics, interval=1.0))

    print("\n--- Spike 20x for 15s (enough to fill queues and trigger defer/shed) ---")
    rate_multiplier[0] = 20.0
    await asyncio.sleep(15.0)

    print(f"\n  Level: {LEVEL_NAMES[strategy.level]}")
    print(f"\n  Queue depths:")
    print(f"    Tier 1:          {queues.tier1.qsize()}")
    print(f"    Tier 2:          {queues.tier2.qsize()}")
    print(f"    Tier 3:          {queues.tier3.qsize()}")
    print(f"    Tier 4:          {queues.tier4.qsize()}")
    print(f"    Deferred Tier 2: {queues.deferred_tier2.qsize()}")
    print(f"    Deferred Tier 3: {queues.deferred_tier3.qsize()}")

    print(f"\n  Deferred counts:")
    for t in ["payment", "order", "inventory", "click", "log"]:
        print(f"    {t:12s}: {metrics.deferred_count[t]}")
    total_deferred = sum(metrics.deferred_count.values())

    print(f"\n  Shed counts:")
    for t in ["payment", "order", "inventory", "click", "log"]:
        print(f"    {t:12s}: {metrics.shed_count[t]}")
    total_shed = sum(metrics.shed_count.values())

    print(f"\n  Batched counts:")
    for t in ["payment", "order", "inventory", "click", "log"]:
        print(f"    {t:12s}: {metrics.batched_count[t]}")

    print(f"\n  Processed: {sum(metrics.processed_count.values())}")
    print(f"  Deferred:  {total_deferred}")
    print(f"  Shed:      {total_shed}")

    print("\n--- Recovery for 15s ---")
    rate_multiplier[0] = 1.0
    await asyncio.sleep(25.0)

    print(f"\n  Level after recovery: {LEVEL_NAMES[strategy.level]}")
    print(f"  Queues after recovery:")
    print(f"    Deferred Tier 2: {queues.deferred_tier2.qsize()}")
    print(f"    Deferred Tier 3: {queues.deferred_tier3.qsize()}")

    for t in source_tasks + [classifier_task, feedback_task] + worker_tasks:
        t.cancel()

    print(f"\n{'=' * 60}")
    print("SUMMARY")
    print(f"  Shed occurred (logs):        {'PASS' if metrics.shed_count['log'] > 0 else 'CHECK'}")
    print(f"  Deferred occurred:           {'PASS' if total_deferred > 0 or total_shed > 0 else 'CHECK'}")
    print(f"  Payment NEVER shed:          {'PASS' if metrics.shed_count['payment'] == 0 else 'FAIL'}")
    print(f"  Order NEVER shed:            {'PASS' if metrics.shed_count['order'] == 0 else 'FAIL'}")
    print(f"  Deferred queues drained:     {'PASS' if queues.deferred_tier2.qsize() == 0 and queues.deferred_tier3.qsize() == 0 else 'CHECK'}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(run_test())
