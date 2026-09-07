import asyncio
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from jugaadflow.generator.sources import ALL_SOURCES
from jugaadflow.pipeline.queues import create_queues
from jugaadflow.pipeline.classifier import classifier_loop
from jugaadflow.pipeline.strategy import Strategy
from jugaadflow.pipeline.worker import worker
from jugaadflow.metrics.store import Metrics

NUM_WORKERS = 8


async def run_test():
    queues = create_queues()
    strategy = Strategy()
    metrics = Metrics()
    rate_multiplier = [1.0]

    print("=" * 60)
    print("JugaadFlow Workers Test (8 workers, process-only mode)")
    print("=" * 60)

    source_tasks = [asyncio.create_task(src(queues.input_queue, rate_multiplier)) for src in ALL_SOURCES]
    classifier_task = asyncio.create_task(classifier_loop(queues, metrics))
    worker_tasks = [asyncio.create_task(worker(i, queues, strategy, metrics)) for i in range(NUM_WORKERS)]

    print("\n  Running for 5 seconds at normal rate...")
    await asyncio.sleep(5.0)

    for t in source_tasks + [classifier_task] + worker_tasks:
        t.cancel()

    await asyncio.sleep(0.1)

    total_processed = sum(metrics.processed_count.values())
    print(f"\n  Total processed: {total_processed}")
    print(f"\n  Processed by type:")
    for etype in ["payment", "order", "inventory", "click", "log"]:
        count = metrics.processed_count[etype]
        pct = (count / total_processed * 100) if total_processed > 0 else 0
        print(f"    {etype:12s}: {count:5d} ({pct:5.1f}%)")

    print(f"\n  Latency (avg ms) by tier:")
    for tier in [1, 2, 3, 4]:
        lat = metrics.avg_latency_ms(tier)
        samples = len(metrics.latency_samples[tier])
        if lat is not None:
            print(f"    Tier {tier}: {lat:7.1f} ms  ({samples} samples)")
        else:
            print(f"    Tier {tier}:     N/A  (0 samples)")

    print(f"\n  Queue depths (should be ~0 at normal rate):")
    print(f"    Tier 1: {queues.tier1.qsize()}")
    print(f"    Tier 2: {queues.tier2.qsize()}")
    print(f"    Tier 3: {queues.tier3.qsize()}")
    print(f"    Tier 4: {queues.tier4.qsize()}")

    print(f"\n  Shed counts (should all be 0 at normal rate):")
    for etype, count in metrics.shed_count.items():
        print(f"    {etype:12s}: {count}")

    all_shed_zero = all(v == 0 for v in metrics.shed_count.values())
    queues_empty = all(q.qsize() == 0 for q in [queues.tier1, queues.tier2, queues.tier3, queues.tier4])

    print(f"\n  Workers keeping up (queues near empty): {'PASS' if queues_empty else 'CHECK'}")
    print(f"  No events shed at normal rate: {'PASS' if all_shed_zero else 'FAIL'}")
    print(f"  Payment shed count = 0: {'PASS' if metrics.shed_count['payment'] == 0 else 'FAIL'}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(run_test())
