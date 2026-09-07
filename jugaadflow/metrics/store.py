import time
from collections import deque
from dataclasses import dataclass, field


@dataclass
class Metrics:
    latency_samples: dict[int, deque] = field(default_factory=lambda: {
        1: deque(maxlen=500),
        2: deque(maxlen=500),
        3: deque(maxlen=500),
        4: deque(maxlen=500),
    })

    processed_count: dict[str, int] = field(default_factory=lambda: {
        "payment": 0, "order": 0, "inventory": 0, "click": 0, "log": 0,
    })
    shed_count: dict[str, int] = field(default_factory=lambda: {
        "payment": 0, "order": 0, "inventory": 0, "click": 0, "log": 0,
    })
    deferred_count: dict[str, int] = field(default_factory=lambda: {
        "payment": 0, "order": 0, "inventory": 0, "click": 0, "log": 0,
    })
    batched_count: dict[str, int] = field(default_factory=lambda: {
        "payment": 0, "order": 0, "inventory": 0, "click": 0, "log": 0,
    })
    duplicates_detected: dict[str, int] = field(default_factory=lambda: {
        "payment": 0, "order": 0, "inventory": 0, "click": 0, "log": 0,
    })

    throughput_window: dict[int, int] = field(default_factory=lambda: {
        1: 0, 2: 0, 3: 0, 4: 0,
    })

    classified_window: dict[int, int] = field(default_factory=lambda: {
        1: 0, 2: 0, 3: 0, 4: 0,
    })

    classified_type_window: dict[str, int] = field(default_factory=lambda: {
        "payment": 0, "order": 0, "inventory": 0, "click": 0, "log": 0,
    })

    current_level: int = 0
    backpressure_active: bool = False
    incoming_rate: float = 0.0
    start_time: float = field(default_factory=time.time)

    recent_events: deque = field(default_factory=lambda: deque(maxlen=50))
    recent_decisions: deque = field(default_factory=lambda: deque(maxlen=50))
    recent_agent_actions: deque = field(default_factory=lambda: deque(maxlen=30))
    emergency_since: float = 0.0

    retries_total: int = 0
    idempotent_skips: int = 0
    dead_letter_count: int = 0
    permanent_failures: int = 0
    starvation_preventions: int = 0
    strict_priority_picks: int = 0
    active_workers: int = 8
    dead_letter_events: deque = field(default_factory=lambda: deque(maxlen=100))
    recent_scheduling: deque = field(default_factory=lambda: deque(maxlen=50))

    def record_classified(self, tier: int, event_type: str = None):
        self.classified_window[tier] += 1
        if event_type and event_type in self.classified_type_window:
            self.classified_type_window[event_type] += 1

    def record_processed(self, event, latency: float):
        self.latency_samples[event.priority].append(latency)
        self.processed_count[event.type] += 1
        self.throughput_window[event.priority] += 1

    def avg_latency(self, tier: int) -> float | None:
        samples = self.latency_samples[tier]
        if not samples:
            return None
        return sum(samples) / len(samples)

    def avg_latency_ms(self, tier: int) -> float | None:
        avg = self.avg_latency(tier)
        return avg * 1000 if avg is not None else None

    def reset_throughput(self):
        for k in self.throughput_window:
            self.throughput_window[k] = 0
        for k in self.classified_window:
            self.classified_window[k] = 0
        for k in self.classified_type_window:
            self.classified_type_window[k] = 0

    def reset_all(self):
        for d in (self.processed_count, self.shed_count, self.deferred_count,
                  self.batched_count, self.duplicates_detected):
            for k in d:
                d[k] = 0
        self.reset_throughput()
        for tier in self.latency_samples:
            self.latency_samples[tier].clear()
        self.recent_events.clear()
        self.recent_decisions.clear()
        self.dead_letter_events.clear()
        self.retries_total = 0
        self.idempotent_skips = 0
        self.dead_letter_count = 0
        self.permanent_failures = 0
        self.starvation_preventions = 0
        self.strict_priority_picks = 0
        self.recent_scheduling.clear()
        self.current_level = 0
        self.backpressure_active = False
        self.emergency_since = 0.0
        self.start_time = time.time()
