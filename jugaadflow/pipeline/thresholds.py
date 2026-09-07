import copy
from dataclasses import dataclass, field


@dataclass
class EscalationThresholds:
    t1_latency_ms: float
    t1_queue: int
    lower_queue: int


@dataclass
class DeescalationThresholds:
    t1_latency_ms: float
    t1_queue: int
    lower_queue: int | None = None


@dataclass
class LevelStrategyParams:
    batch_sizes: dict[str, int] = field(default_factory=lambda: {"tier2": 20, "tier3": 50, "tier4": 100})
    shed_sample_rate: float = 0.1


def _default_escalation() -> dict[int, EscalationThresholds]:
    return {
        1: EscalationThresholds(t1_latency_ms=80.0, t1_queue=100, lower_queue=50),
        2: EscalationThresholds(t1_latency_ms=150.0, t1_queue=500, lower_queue=200),
        3: EscalationThresholds(t1_latency_ms=300.0, t1_queue=1000, lower_queue=500),
    }


def _default_deescalation() -> dict[int, DeescalationThresholds]:
    return {
        3: DeescalationThresholds(t1_latency_ms=100.0, t1_queue=10),
        2: DeescalationThresholds(t1_latency_ms=60.0, t1_queue=5),
        1: DeescalationThresholds(t1_latency_ms=55.0, t1_queue=5, lower_queue=20),
    }


def _default_level_params() -> dict[int, LevelStrategyParams]:
    return {
        0: LevelStrategyParams(shed_sample_rate=0.1),
        1: LevelStrategyParams(shed_sample_rate=0.1),
        2: LevelStrategyParams(shed_sample_rate=0.1),
        3: LevelStrategyParams(shed_sample_rate=0.05),
    }


@dataclass
class Thresholds:
    escalation: dict[int, EscalationThresholds] = field(default_factory=_default_escalation)
    deescalation: dict[int, DeescalationThresholds] = field(default_factory=_default_deescalation)
    deescalation_cooldown: float = 6.0
    backpressure_threshold: int = 8000
    backpressure_release: int = 5000
    level_params: dict[int, LevelStrategyParams] = field(default_factory=_default_level_params)

    def snapshot(self) -> dict:
        out = {
            "deescalation_cooldown": self.deescalation_cooldown,
            "backpressure_threshold": self.backpressure_threshold,
            "backpressure_release": self.backpressure_release,
        }
        for level, t in self.escalation.items():
            out[f"escalation.{level}.t1_latency_ms"] = t.t1_latency_ms
            out[f"escalation.{level}.t1_queue"] = t.t1_queue
            out[f"escalation.{level}.lower_queue"] = t.lower_queue
        for level, t in self.deescalation.items():
            out[f"deescalation.{level}.t1_latency_ms"] = t.t1_latency_ms
            out[f"deescalation.{level}.t1_queue"] = t.t1_queue
            if t.lower_queue is not None:
                out[f"deescalation.{level}.lower_queue"] = t.lower_queue
        for level, p in self.level_params.items():
            out[f"level_params.{level}.batch_sizes"] = copy.deepcopy(p.batch_sizes)
            out[f"level_params.{level}.shed_sample_rate"] = p.shed_sample_rate
        return out

    def apply_changes(self, changes: dict):
        for key, value in changes.items():
            parts = key.split(".")
            if parts[0] == "escalation" and len(parts) == 3:
                level = int(parts[1])
                setattr(self.escalation[level], parts[2], value)
            elif parts[0] == "deescalation" and len(parts) == 3:
                level = int(parts[1])
                setattr(self.deescalation[level], parts[2], value)
            elif parts[0] == "level_params" and len(parts) == 3:
                level = int(parts[1])
                if parts[2] == "batch_sizes" and isinstance(value, dict):
                    self.level_params[level].batch_sizes = value
                elif parts[2] == "shed_sample_rate":
                    self.level_params[level].shed_sample_rate = value
            elif key == "deescalation_cooldown":
                self.deescalation_cooldown = value
            elif key == "backpressure_threshold":
                self.backpressure_threshold = value
            elif key == "backpressure_release":
                self.backpressure_release = value

    def restore(self, snap: dict):
        fresh = Thresholds()
        fresh.apply_changes(snap)
        self.escalation = fresh.escalation
        self.deescalation = fresh.deescalation
        self.deescalation_cooldown = fresh.deescalation_cooldown
        self.backpressure_threshold = fresh.backpressure_threshold
        self.backpressure_release = fresh.backpressure_release
        self.level_params = fresh.level_params
