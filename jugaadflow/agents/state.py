import time
from collections import deque
from dataclasses import dataclass, field


@dataclass
class MetricsSnapshot:
    timestamp: float = 0.0
    t1_avg_latency_ms: float | None = None
    t2_avg_latency_ms: float | None = None
    t3_avg_latency_ms: float | None = None
    t4_avg_latency_ms: float | None = None
    total_throughput: int = 0
    total_shed: int = 0
    payment_shed: int = 0
    total_deferred: int = 0
    queue_depths: dict[str, int] = field(default_factory=dict)
    current_level: int = 0
    level_transitions: int = 0

    def to_dict(self) -> dict:
        return {
            "timestamp": self.timestamp,
            "latency_ms": {
                "tier1": self.t1_avg_latency_ms,
                "tier2": self.t2_avg_latency_ms,
                "tier3": self.t3_avg_latency_ms,
                "tier4": self.t4_avg_latency_ms,
            },
            "total_throughput": self.total_throughput,
            "total_shed": self.total_shed,
            "payment_shed": self.payment_shed,
            "total_deferred": self.total_deferred,
            "queue_depths": self.queue_depths,
            "current_level": self.current_level,
            "level_transitions": self.level_transitions,
        }


def capture_snapshot(metrics, queues) -> MetricsSnapshot:
    return MetricsSnapshot(
        timestamp=time.time(),
        t1_avg_latency_ms=metrics.avg_latency_ms(1),
        t2_avg_latency_ms=metrics.avg_latency_ms(2),
        t3_avg_latency_ms=metrics.avg_latency_ms(3),
        t4_avg_latency_ms=metrics.avg_latency_ms(4),
        total_throughput=sum(metrics.throughput_window.values()),
        total_shed=sum(metrics.shed_count.values()),
        payment_shed=metrics.shed_count.get("payment", 0),
        total_deferred=sum(metrics.deferred_count.values()),
        queue_depths={
            "tier1": queues.tier1.qsize(),
            "tier2": queues.tier2.qsize(),
            "tier3": queues.tier3.qsize(),
            "tier4": queues.tier4.qsize(),
            "deferred_tier2": queues.deferred_tier2.qsize(),
            "deferred_tier3": queues.deferred_tier3.qsize(),
            "input": queues.input_queue.qsize(),
            "kafka": queues.kafka_overflow.qsize(),
        },
        current_level=metrics.current_level,
        level_transitions=len(metrics.recent_decisions),
    )


@dataclass
class AgentState:
    agents_enabled: bool = False
    pending_evaluation: bool = False
    change_applied_at: float = 0.0
    before_snapshot: MetricsSnapshot | None = None
    before_thresholds: dict | None = None
    optimizer_reasoning: str = ""
    changes_applied: dict = field(default_factory=dict)
    consecutive_reverts: int = 0
    optimizer_paused_until: float = 0.0
    last_evaluation_result: str = ""
    recent_actions: deque = field(default_factory=lambda: deque(maxlen=30))
    validation_window: float = 20.0
    optimizer_interval: float = 30.0
    optimizer_consecutive_failures: int = 0
    human_alert_active: bool = False
    last_alert_at: float = 0.0
    alert_reason: str = ""
    alert_cooldown: float = 300.0
