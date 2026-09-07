import asyncio
import sys
import os
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from jugaadflow.generator.sources import ALL_SOURCES
from jugaadflow.pipeline.queues import create_queues
from jugaadflow.pipeline.classifier import classifier_loop
from jugaadflow.metrics.store import Metrics


async def run_test():
    queues = create_queues()
    metrics = Metrics()
    rate_multiplier = [1.0]

    print("=" * 60)
    print("JugaadFlow Classifier + Queues Test")
    print("=" * 60)

    source_tasks = [asyncio.create_task(src(queues.input_queue, rate_multiplier)) for src in ALL_SOURCES]
    classifier_task = asyncio.create_task(classifier_loop(queues, metrics, None))

    await asyncio.sleep(5.0)

    for t in source_tasks:
        t.cancel()
    classifier_task.cancel()

    await asyncio.sleep(0.1)

    t1 = queues.tier1.qsize()
    t2 = queues.tier2.qsize()
    t3 = queues.tier3.qsize()
    t4 = queues.tier4.qsize()
    total = t1 + t2 + t3 + t4

    print(f"\n  Tier 1 (payment+order): {t1:5d}  ({t1/total*100:5.1f}%)  [expected ~13%]")
    print(f"  Tier 2 (inventory):     {t2:5d}  ({t2/total*100:5.1f}%)  [expected ~13%]")
    print(f"  Tier 3 (click):         {t3:5d}  ({t3/total*100:5.1f}%)  [expected ~28%]")
    print(f"  Tier 4 (log):           {t4:5d}  ({t4/total*100:5.1f}%)  [expected ~46%]")
    print(f"  Total:                  {total}")

    # Verify priorities are set correctly
    sample_events = []
    for _ in range(min(5, queues.tier1.qsize())):
        sample_events.append(queues.tier1.get_nowait())
    for _ in range(min(5, queues.tier4.qsize())):
        sample_events.append(queues.tier4.get_nowait())

    print(f"\n  Sample tier 1 events:")
    for e in sample_events[:5]:
        print(f"    {e.id} type={e.type} priority={e.priority} source={e.source}")
    print(f"  Sample tier 4 events:")
    for e in sample_events[5:]:
        print(f"    {e.id} type={e.type} priority={e.priority} source={e.source}")

    t1_correct = all(e.priority == 1 and e.type in ("payment", "order") for e in sample_events[:5])
    t4_correct = all(e.priority == 4 and e.type == "log" for e in sample_events[5:])

    print(f"\n  Tier 1 priorities correct: {'PASS' if t1_correct else 'FAIL'}")
    print(f"  Tier 4 priorities correct: {'PASS' if t4_correct else 'FAIL'}")
    print(f"  Input queue drained:       {'PASS' if queues.input_queue.qsize() == 0 else 'FAIL (remaining: ' + str(queues.input_queue.qsize()) + ')'}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(run_test())
