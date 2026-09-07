import asyncio
import json
import logging
import random
import time
from pathlib import Path

import fastapi
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

logger = logging.getLogger("jugaadflow.server")

from jugaadflow.generator.event import Event
from jugaadflow.generator import payloads
from jugaadflow.pipeline.queues import Queues
from jugaadflow.pipeline.strategy import Strategy
from jugaadflow.pipeline.thresholds import Thresholds
from jugaadflow.metrics.store import Metrics
from jugaadflow.pipeline.decision_engine import LEVEL_NAMES
from jugaadflow.agents.state import AgentState

STATIC_DIR = Path(__file__).parent / "static"
FRONTEND_DIST = Path(__file__).parent.parent.parent / "frontend" / "dist"
BASE_EVENTS_PER_MIN = 3400.0


class RateRequest(BaseModel):
    events_per_min: float


class EventSpikeRequest(BaseModel):
    event_type: str
    count: int = 500
    duration_sec: float = 5.0


class FloodRequest(BaseModel):
    tier2_count: int = 4500
    tier3_count: int = 1800
    tier4_count: int = 480
    input_count: int = 8000


# Global registry: event_type -> (end_time, total_injected)
_active_spikes: dict[str, dict] = {}

EVENT_PAYLOAD_MAP = {
    "payment":   (payloads.payment_payload,   "payment-gateway",   1),
    "order":     (payloads.order_payload,      "order-service",     1),
    "inventory": (payloads.inventory_payload,  "inventory-service", 2),
    "click":     (payloads.click_payload,      "clickstream",       3),
    "log":       (payloads.log_payload,        "app-logger",        4),
}


def create_app(
    queues: Queues,
    strategy: Strategy,
    metrics: Metrics,
    rate_multiplier: list[float],
    thresholds: Thresholds | None = None,
    agent_state: AgentState | None = None,
    worker_kill_flags: list | None = None,
    dedup_filter=None,
    completed_events: dict | None = None,
) -> FastAPI:
    app = FastAPI(title="JugaadFlow Dashboard")
    clients: list[WebSocket] = []

    if FRONTEND_DIST.exists():
        app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

        @app.get("/old")
        async def old_dashboard():
            return HTMLResponse((STATIC_DIR / "index.html").read_text())
    else:
        @app.get("/style.css")
        async def style():
            from fastapi.responses import Response
            return Response(content=(STATIC_DIR / "style.css").read_text(), media_type="text/css")

        @app.get("/dashboard.js")
        async def js():
            from fastapi.responses import Response
            return Response(content=(STATIC_DIR / "dashboard.js").read_text(), media_type="application/javascript")

    @app.websocket("/ws")
    async def websocket_endpoint(ws: WebSocket):
        await ws.accept()
        clients.append(ws)
        try:
            while True:
                await ws.receive_text()
        except WebSocketDisconnect:
            if ws in clients:
                clients.remove(ws)

    @app.post("/api/spike")
    async def trigger_spike():
        rate_multiplier[0] = 20.0
        return {"status": "spike", "rate_multiplier": 20.0}

    @app.post("/api/normal")
    async def trigger_normal():
        rate_multiplier[0] = 1.0
        return {"status": "normal", "rate_multiplier": 1.0}

    @app.post("/api/rate")
    async def set_rate(req: RateRequest):
        multiplier = max(0.1, min(200.0, req.events_per_min / BASE_EVENTS_PER_MIN))
        rate_multiplier[0] = multiplier
        return {
            "rate_multiplier": round(multiplier, 2),
            "events_per_min": round(multiplier * BASE_EVENTS_PER_MIN),
        }

    @app.post("/api/mode/naive")
    async def set_naive():
        app.state.naive_mode = True
        strategy.naive_mode = True
        strategy.level = 0
        strategy.tier2 = "process"
        strategy.tier3 = "process"
        strategy.tier4 = "process"
        strategy.drain_deferred = False
        return {"mode": "naive"}

    @app.post("/api/mode/adaptive")
    async def set_adaptive():
        app.state.naive_mode = False
        strategy.naive_mode = False
        return {"mode": "adaptive"}

    @app.post("/api/event-spike")
    async def event_spike(req: EventSpikeRequest):
        """Inject a burst of a specific event type into the input queue."""
        etype = req.event_type.lower()
        if etype not in EVENT_PAYLOAD_MAP:
            from fastapi import HTTPException
            raise HTTPException(status_code=400, detail=f"Unknown event_type '{etype}'. Choose from: {list(EVENT_PAYLOAD_MAP.keys())}")

        payload_fn, source_name, priority = EVENT_PAYLOAD_MAP[etype]
        count = max(1, min(req.count, 50000))
        injected = 0
        dropped = 0

        for _ in range(count):
            evt = Event(type=etype, source=f"admin-spike/{source_name}", payload=payload_fn(), priority=priority)
            try:
                queues.input_queue.put_nowait(evt)
                injected += 1
            except asyncio.QueueFull:
                dropped += 1

        # Track active spike for dashboard highlighting
        end_time = time.time() + req.duration_sec
        _active_spikes[etype] = {
            "end_time": end_time,
            "count": count,
            "injected": injected,
            "dropped": dropped,
            "started_at": time.strftime("%H:%M:%S"),
        }

        logger.info("Admin spike: %d %s events injected (%d dropped)", injected, etype, dropped)
        return {
            "status": "spike_injected",
            "event_type": etype,
            "injected": injected,
            "dropped": dropped,
        }

    @app.get("/api/event-spike/active")
    async def get_active_spikes():
        now = time.time()
        # Clean up expired
        expired = [k for k, v in _active_spikes.items() if v["end_time"] < now]
        for k in expired:
            del _active_spikes[k]
        return {"active_spikes": dict(_active_spikes)}

    @app.post("/api/inject-duplicate")
    async def inject_duplicate(req: EventSpikeRequest):
        etype = req.event_type.lower()
        if etype not in EVENT_PAYLOAD_MAP:
            from fastapi import HTTPException
            raise HTTPException(status_code=400, detail=f"Unknown event_type '{etype}'")
        payload_fn, source_name, priority = EVENT_PAYLOAD_MAP[etype]
        fixed_payload = payload_fn()
        injected = 0
        for _ in range(2):
            evt = Event(type=etype, source=f"dedup-test/{source_name}",
                        payload=dict(fixed_payload), priority=priority)
            try:
                queues.input_queue.put_nowait(evt)
                injected += 1
            except asyncio.QueueFull:
                pass
        return {"status": "duplicate_pair_injected", "event_type": etype, "injected": injected}

    @app.post("/api/flood")
    async def trigger_flood(req: FloodRequest = FloodRequest()):
        injected = {"tier2": 0, "tier3": 0, "tier4": 0, "input": 0}
        overflow = {"tier2": 0, "tier3": 0, "tier4": 0, "input": 0}

        for _ in range(req.tier2_count):
            evt = Event(type="inventory", source="flood-sim",
                        payload=payloads.inventory_payload(), priority=2)
            try:
                queues.tier2.put_nowait(evt)
                injected["tier2"] += 1
            except asyncio.QueueFull:
                overflow["tier2"] += 1
                metrics.shed_count["inventory"] += 1

        for _ in range(req.tier3_count):
            evt = Event(type="click", source="flood-sim",
                        payload=payloads.click_payload(), priority=3)
            try:
                queues.tier3.put_nowait(evt)
                injected["tier3"] += 1
            except asyncio.QueueFull:
                overflow["tier3"] += 1
                metrics.shed_count["click"] += 1

        for _ in range(req.tier4_count):
            evt = Event(type="log", source="flood-sim",
                        payload=payloads.log_payload(), priority=4)
            try:
                queues.tier4.put_nowait(evt)
                injected["tier4"] += 1
            except asyncio.QueueFull:
                overflow["tier4"] += 1
                metrics.shed_count["log"] += 1

        type_pool = [
            ("inventory", payloads.inventory_payload, "inventory-service"),
            ("click", payloads.click_payload, "clickstream"),
            ("log", payloads.log_payload, "app-logger"),
        ]
        for _ in range(req.input_count):
            etype, pfn, src = random.choice(type_pool)
            evt = Event(type=etype, source="flood-sim", payload=pfn())
            try:
                queues.input_queue.put_nowait(evt)
                injected["input"] += 1
            except asyncio.QueueFull:
                overflow["input"] += 1

        return {
            "status": "flood_injected",
            "injected": injected,
            "overflow": overflow,
        }

    if agent_state is not None:
        @app.post("/api/agents/enable")
        async def enable_agents():
            agent_state.agents_enabled = True
            return {"agents_enabled": True}

        @app.post("/api/agents/disable")
        async def disable_agents():
            agent_state.agents_enabled = False
            return {"agents_enabled": False}

        @app.get("/api/agents/status")
        async def agents_status():
            return {
                "enabled": agent_state.agents_enabled,
                "pending_evaluation": agent_state.pending_evaluation,
                "consecutive_reverts": agent_state.consecutive_reverts,
                "last_result": agent_state.last_evaluation_result,
                "recent_actions": list(agent_state.recent_actions),
            }

        @app.post("/api/agents/trigger")
        async def trigger_optimizer():
            if not agent_state.agents_enabled:
                return {"error": "agents not enabled"}
            if agent_state.pending_evaluation:
                return {"error": "evaluator still pending — wait for it to finish"}
            from jugaadflow.agents.optimizer import _build_user_prompt, _safe_llm_call, _validate_changes, _log_action
            from jugaadflow.agents import get_client, RateLimitError
            from jugaadflow.agents.state import capture_snapshot
            import time as _time
            client = get_client()
            if not client:
                return {"error": "no Gemini API key"}
            user_msg = _build_user_prompt(thresholds, metrics, queues)
            try:
                result = await _safe_llm_call(client, user_msg)
            except RateLimitError as e:
                return {"error": "Gemini rate limited — wait ~60s and retry"}
            if result is None:
                return {"error": "LLM call failed"}
            changes = result.get("changes", {})
            reasoning = result.get("reasoning", "")
            confidence = result.get("confidence", 0.5)
            if not changes:
                _log_action(agent_state, "no_change", reasoning, confidence)
                return {"status": "no_change", "reasoning": reasoning}
            error = _validate_changes(changes, thresholds)
            if error:
                _log_action(agent_state, "rejected", f"Validation failed: {error}", confidence, changes)
                return {"status": "rejected", "error": error}
            before_snap = capture_snapshot(metrics, queues)
            before_thresholds = thresholds.snapshot()
            thresholds.apply_changes(changes)
            agent_state.before_snapshot = before_snap
            agent_state.before_thresholds = before_thresholds
            agent_state.changes_applied = changes
            agent_state.optimizer_reasoning = reasoning
            agent_state.change_applied_at = _time.time()
            agent_state.pending_evaluation = True
            change_summary = ", ".join(f"{k}={v}" for k, v in changes.items())
            _log_action(agent_state, "applied", f"{reasoning[:120]} | Changes: {change_summary}", confidence, changes)
            return {"status": "applied", "changes": changes, "reasoning": reasoning, "confidence": confidence}

        @app.post("/api/alerts/acknowledge")
        async def acknowledge_alert():
            agent_state.human_alert_active = False
            agent_state.alert_reason = ""
            return {"acknowledged": True}

        @app.get("/api/alerts/status")
        async def alerts_status():
            return {
                "active": agent_state.human_alert_active,
                "reason": agent_state.alert_reason,
                "last_alert_at": agent_state.last_alert_at,
            }

        @app.post("/api/alerts/test-call")
        async def test_escalation_call():
            from jugaadflow.agents.escalation import (
                _generate_call_message, _make_twilio_call, TWILIO_SID,
            )
            from jugaadflow.agents import get_client as get_llm_client, RateLimitError

            if not TWILIO_SID:
                return {"error": "Twilio credentials not configured"}

            reason = "TEST: Simulated escalation — verifying voice call system"
            import jugaadflow.agents.escalation as esc_module
            esc_module.pending_call_reason = reason
            llm_client = get_llm_client()
            message = await _generate_call_message(llm_client, reason, metrics, queues)

            try:
                call_sid = await asyncio.to_thread(_make_twilio_call, message)
            except Exception as e:
                return {"error": str(e)}

            agent_state.human_alert_active = True
            agent_state.last_alert_at = time.time()
            agent_state.alert_reason = reason

            return {"status": "call_initiated", "call_sid": call_sid}

    @app.post("/api/kill-worker")
    async def kill_worker():
        if worker_kill_flags is None:
            return {"error": "worker_kill_flags not configured"}
        alive = [i for i, killed in enumerate(worker_kill_flags) if not killed]
        if not alive:
            return {"error": "all workers already killed"}
        victim = random.choice(alive)
        worker_kill_flags[victim] = True
        metrics.active_workers = sum(1 for f in worker_kill_flags if not f)

        async def revive():
            await asyncio.sleep(5.0)
            worker_kill_flags[victim] = False
            metrics.active_workers = sum(1 for f in worker_kill_flags if not f)

        asyncio.create_task(revive())
        return {"status": "worker_killed", "worker_id": victim, "revive_in_sec": 5}

    @app.post("/api/reset")
    async def reset_metrics():
        metrics.reset_all()
        strategy.level = 0
        strategy.tier2 = "process"
        strategy.tier3 = "process"
        strategy.tier4 = "process"
        strategy.shed_sample_rate = 0.1
        strategy.drain_deferred = False
        if dedup_filter is not None:
            dedup_filter._seen.clear()
        if completed_events is not None:
            completed_events.clear()
        return {"status": "reset"}

    @app.post("/api/twiml/alert")
    async def twiml_alert(request: fastapi.Request):
        from xml.sax.saxutils import escape as xml_escape
        from fastapi.responses import Response
        from jugaadflow.agents.escalation import (
            pending_call_message, pending_call_reason,
            _get_public_url, init_call_conversation,
        )

        form = await request.form()
        call_sid = form.get("CallSid", "unknown")

        msg = pending_call_message or "JugaadFlow alert. Please check the dashboard."
        init_call_conversation(call_sid, msg, pending_call_reason)

        public_url = _get_public_url()
        respond_url = xml_escape(f"{public_url}/api/twiml/respond")
        wait_url = xml_escape(f"{public_url}/api/twiml/wait")
        safe_msg = xml_escape(msg)

        twiml = (
            f'<?xml version="1.0" encoding="UTF-8"?>'
            f'<Response>'
            f'<Gather input="speech" action="{respond_url}" method="POST" speechTimeout="auto" language="en-IN" speechModel="phone_call">'
            f'<Say voice="alice">{safe_msg}</Say>'
            f'</Gather>'
            f'<Redirect method="POST">{wait_url}</Redirect>'
            f'</Response>'
        )
        return Response(content=twiml, media_type="application/xml")

    @app.post("/api/twiml/wait")
    async def twiml_wait(request: fastapi.Request):
        from xml.sax.saxutils import escape as xml_escape
        from fastapi.responses import Response
        from jugaadflow.agents.escalation import _get_public_url

        public_url = _get_public_url()
        respond_url = xml_escape(f"{public_url}/api/twiml/respond")
        wait_url = xml_escape(f"{public_url}/api/twiml/wait")

        twiml = (
            f'<?xml version="1.0" encoding="UTF-8"?>'
            f'<Response>'
            f'<Gather input="speech" action="{respond_url}" method="POST" speechTimeout="auto" language="en-IN" speechModel="phone_call">'
            f'<Say voice="alice">I am still here. Take your time.</Say>'
            f'</Gather>'
            f'<Redirect method="POST">{wait_url}</Redirect>'
            f'</Response>'
        )
        return Response(content=twiml, media_type="application/xml")

    @app.post("/api/twiml/respond")
    async def twiml_respond(request: fastapi.Request):
        from xml.sax.saxutils import escape as xml_escape
        from fastapi.responses import Response
        from jugaadflow.agents.escalation import (
            generate_conversation_reply, cleanup_call, _get_public_url,
        )

        form = await request.form()
        call_sid = form.get("CallSid", "unknown")
        speech = form.get("SpeechResult", "")

        logger.info("Call %s — admin said: %s", call_sid, speech)

        reply, end_call = await generate_conversation_reply(
            call_sid, speech, metrics, queues,
        )

        logger.info("Call %s — LLM replied: %s (end=%s)", call_sid, reply[:100], end_call)

        safe_reply = xml_escape(reply)

        if end_call:
            cleanup_call(call_sid)
            twiml = (
                f'<?xml version="1.0" encoding="UTF-8"?>'
                f'<Response><Say voice="alice">{safe_reply}</Say></Response>'
            )
        else:
            public_url = _get_public_url()
            respond_url = xml_escape(f"{public_url}/api/twiml/respond")
            wait_url = xml_escape(f"{public_url}/api/twiml/wait")
            twiml = (
                f'<?xml version="1.0" encoding="UTF-8"?>'
                f'<Response>'
                f'<Gather input="speech" action="{respond_url}" method="POST" speechTimeout="auto" language="en-IN" speechModel="phone_call">'
                f'<Say voice="alice">{safe_reply}</Say>'
                f'</Gather>'
                f'<Redirect method="POST">{wait_url}</Redirect>'
                f'</Response>'
            )
        return Response(content=twiml, media_type="application/xml")

    app.state.clients = clients
    app.state.naive_mode = False
    app.state.thresholds = thresholds
    app.state.agent_state = agent_state

    @app.get("/{path:path}")
    async def spa_fallback(path: str):
        from fastapi.responses import FileResponse
        if FRONTEND_DIST.exists():
            file_path = FRONTEND_DIST / path
            if file_path.is_file():
                return FileResponse(file_path)
            return FileResponse(FRONTEND_DIST / "index.html")
        return HTMLResponse((STATIC_DIR / "index.html").read_text())

    return app


def build_metrics_payload(
    queues: Queues,
    strategy: Strategy,
    metrics: Metrics,
    rate_multiplier: list[float],
    app_ref=None,
) -> dict:
    return {
        "timestamp": time.time(),
        "level": strategy.level,
        "level_name": LEVEL_NAMES[strategy.level],
        "backpressure": metrics.backpressure_active,
        "rate_multiplier": rate_multiplier[0],
        "queues": {
            "tier1": queues.tier1.qsize(),
            "tier2": queues.tier2.qsize(),
            "tier3": queues.tier3.qsize(),
            "tier4": queues.tier4.qsize(),
            "deferred_tier2": queues.deferred_tier2.qsize(),
            "deferred_tier3": queues.deferred_tier3.qsize(),
            "input": queues.input_queue.qsize(),
            "fifo": queues.fifo.qsize(),
        },
        "latency_ms": {
            f"tier{t}": (round(ms, 1) if (ms := metrics.avg_latency_ms(t)) is not None else None)
            for t in range(1, 5)
        },
        "naive_mode": getattr(app_ref.state, 'naive_mode', False) if app_ref else False,
        "throughput_per_sec": dict(metrics.throughput_window),
        "counters": {
            "processed": dict(metrics.processed_count),
            "shed": dict(metrics.shed_count),
            "deferred": dict(metrics.deferred_count),
            "batched": dict(metrics.batched_count),
            "duplicates": dict(metrics.duplicates_detected),
        },
        "incoming_rate": metrics.incoming_rate,
        "classified_per_sec": dict(metrics.classified_window),
        "classified_type_per_sec": dict(metrics.classified_type_window),
        "recent_events": list(metrics.recent_events),
        "recent_decisions": list(metrics.recent_decisions),
        "agent_activity": list(metrics.recent_agent_actions),
        "active_spikes": {
            k: v for k, v in _active_spikes.items()
            if v["end_time"] > time.time()
        },
        "agents_enabled": (
            getattr(app_ref.state, 'agent_state', None).agents_enabled
            if app_ref and getattr(app_ref.state, 'agent_state', None) else False
        ),
        "current_thresholds": (
            app_ref.state.thresholds.snapshot()
            if app_ref and getattr(app_ref.state, 'thresholds', None) else None
        ),
        "fault_tolerance": {
            "retries_total": metrics.retries_total,
            "idempotent_skips": metrics.idempotent_skips,
            "dead_letter_count": metrics.dead_letter_count,
            "active_workers": metrics.active_workers,
            "total_workers": 8,
            "dead_letter_events": list(metrics.dead_letter_events),
        },
        "human_alert": (
            {
                "active": app_ref.state.agent_state.human_alert_active,
                "reason": app_ref.state.agent_state.alert_reason,
                "time": time.strftime("%H:%M:%S", time.localtime(app_ref.state.agent_state.last_alert_at))
                        if app_ref.state.agent_state.last_alert_at > 0 else None,
            }
            if app_ref and getattr(app_ref.state, 'agent_state', None) else None
        ),
        "scheduling": {
            "starvation_preventions": metrics.starvation_preventions,
            "strict_priority_picks": metrics.strict_priority_picks,
            "permanent_failures": metrics.permanent_failures,
            "recent_decisions": list(metrics.recent_scheduling),
        },
    }


async def metrics_broadcaster(
    queues: Queues,
    strategy: Strategy,
    metrics: Metrics,
    rate_multiplier: list[float],
    app: FastAPI,
    interval: float = 1.0,
):
    while True:
        await asyncio.sleep(interval)
        payload = build_metrics_payload(queues, strategy, metrics, rate_multiplier, app)
        metrics.reset_throughput()
        data = json.dumps(payload)
        dead = []
        for ws in app.state.clients:
            try:
                await ws.send_text(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            app.state.clients.remove(ws)
