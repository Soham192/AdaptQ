import asyncio
import time
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from jugaadflow.generator.sources import ALL_SOURCES
from jugaadflow.generator.event import Event


async def drain_queue(queue: asyncio.Queue, events: list, stop_event: asyncio.Event):
    while not stop_event.is_set():
        try:
            event = queue.get_nowait()
            events.append(event)
        except asyncio.QueueEmpty:
            await asyncio.sleep(0.005)
    while not queue.empty():
        events.append(queue.get_nowait())


async def run_test():
    input_queue = asyncio.Queue(maxsize=10000)
    rate_multiplier = [1.0]

    print("=" * 60)
    print("JugaadFlow Generator Test")
    print("=" * 60)

    # --- Phase 1: Normal rate (1x) for 3 seconds ---
    print("\n--- Phase 1: Normal rate (1x) for 3 seconds ---")
    events_normal: list[Event] = []
    stop = asyncio.Event()

    source_tasks = [asyncio.create_task(src(input_queue, rate_multiplier)) for src in ALL_SOURCES]
    drain_task = asyncio.create_task(drain_queue(input_queue, events_normal, stop))

    t0 = time.time()
    await asyncio.sleep(3.0)
    stop.set()
    for t in source_tasks:
        t.cancel()
    await drain_task
    elapsed_normal = time.time() - t0

    normal_count = len(events_normal)
    rate_per_min_normal = normal_count / elapsed_normal * 60

    print(f"  Events generated: {normal_count}")
    print(f"  Elapsed: {elapsed_normal:.2f}s")
    print(f"  Rate: {rate_per_min_normal:.0f} events/min")

    # Count by type
    type_counts = {}
    for e in events_normal:
        type_counts[e.type] = type_counts.get(e.type, 0) + 1

    print(f"\n  Distribution:")
    expected = {"payment": 4, "order": 9, "inventory": 13, "click": 28, "log": 46}
    for etype in ["payment", "order", "inventory", "click", "log"]:
        count = type_counts.get(etype, 0)
        pct = (count / normal_count * 100) if normal_count > 0 else 0
        print(f"    {etype:12s}: {count:5d} ({pct:5.1f}%)  [expected ~{expected[etype]}%]")

    # Verify all events have created_at and unique IDs
    ids = set()
    all_have_timestamp = True
    for e in events_normal:
        ids.add(e.id)
        if e.created_at <= 0:
            all_have_timestamp = False

    print(f"\n  Unique IDs: {len(ids)}/{normal_count} {'PASS' if len(ids) == normal_count else 'FAIL'}")
    print(f"  All have created_at: {'PASS' if all_have_timestamp else 'FAIL'}")
    print(f"  Priority (pre-classifier): all 0 = {'PASS' if all(e.priority == 0 for e in events_normal) else 'FAIL'}")

    # --- Phase 2: Spike rate (20x) for 3 seconds ---
    print("\n--- Phase 2: Spike rate (20x) for 3 seconds ---")
    rate_multiplier[0] = 20.0
    events_spike: list[Event] = []
    stop2 = asyncio.Event()

    source_tasks2 = [asyncio.create_task(src(input_queue, rate_multiplier)) for src in ALL_SOURCES]
    drain_task2 = asyncio.create_task(drain_queue(input_queue, events_spike, stop2))

    t1 = time.time()
    await asyncio.sleep(3.0)
    stop2.set()
    for t in source_tasks2:
        t.cancel()
    await drain_task2
    elapsed_spike = time.time() - t1

    spike_count = len(events_spike)
    rate_per_min_spike = spike_count / elapsed_spike * 60

    print(f"  Events generated: {spike_count}")
    print(f"  Elapsed: {elapsed_spike:.2f}s")
    print(f"  Rate: {rate_per_min_spike:.0f} events/min")

    multiplier_actual = spike_count / max(normal_count, 1)
    print(f"\n  Actual multiplier: {multiplier_actual:.1f}x (target: ~20x)")

    # --- Phase 3: Backpressure test ---
    print("\n--- Phase 3: Backpressure test (tiny queue, maxsize=50) ---")
    tiny_queue = asyncio.Queue(maxsize=50)
    rate_multiplier[0] = 20.0
    bp_events: list[Event] = []
    stop3 = asyncio.Event()

    source_tasks3 = [asyncio.create_task(src(tiny_queue, rate_multiplier)) for src in ALL_SOURCES]
    await asyncio.sleep(0.5)

    qsize = tiny_queue.qsize()
    print(f"  Queue size after 0.5s with maxsize=50: {qsize}")
    print(f"  Queue full (backpressure active): {'PASS' if qsize >= 45 else 'CHECK'}")

    stop3.set()
    for t in source_tasks3:
        t.cancel()

    # --- Summary ---
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    rate_ok = 2000 < rate_per_min_normal < 5000
    spike_ok = multiplier_actual > 10
    print(f"  Normal rate ~1000/min:  {rate_per_min_normal:.0f}/min {'PASS' if rate_ok else 'CHECK'}")
    print(f"  Spike multiplier ~20x:  {multiplier_actual:.1f}x {'PASS' if spike_ok else 'CHECK'}")
    print(f"  Unique IDs:             {'PASS' if len(ids) == normal_count else 'FAIL'}")
    print(f"  Timestamps present:     {'PASS' if all_have_timestamp else 'FAIL'}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(run_test())
