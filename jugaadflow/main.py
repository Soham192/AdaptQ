import asyncio
import logging
import os
import sys

# Load .env BEFORE any other imports so all env vars (GROQ_API_KEY, Twilio, etc.) are available
try:
    from dotenv import load_dotenv
    _env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    load_dotenv(_env_path, override=True)
except ImportError:
    pass  # python-dotenv not installed; rely on system env vars

import uvicorn

from jugaadflow.generator.sources import ALL_SOURCES
from jugaadflow.pipeline.queues import create_queues
from jugaadflow.pipeline.classifier import classifier_loop
from jugaadflow.pipeline.dedup import DedupFilter, dedup_purge_loop
from jugaadflow.pipeline.strategy import Strategy
from jugaadflow.pipeline.worker import worker, completed_events_cleanup, kafka_consumer_loop
from jugaadflow.pipeline.decision_engine import feedback_loop
from jugaadflow.pipeline.thresholds import Thresholds
from jugaadflow.metrics.store import Metrics
from jugaadflow.agents.state import AgentState
from jugaadflow.dashboard.server import create_app, metrics_broadcaster

NUM_WORKERS = 8
logger = logging.getLogger("jugaadflow")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(message)s",
    datefmt="%H:%M:%S",
)


async def main():
    queues = create_queues()
    strategy = Strategy()
    metrics = Metrics()
    thresholds = Thresholds()
    agent_state = AgentState()
    rate_multiplier = [1.0]
    dedup_filter = DedupFilter(ttl=30.0)
    completed_events = {}
    worker_kill_flags = [False] * NUM_WORKERS
    dead_letter = metrics.dead_letter_events
    metrics.active_workers = NUM_WORKERS

    app = create_app(queues, strategy, metrics, rate_multiplier, thresholds, agent_state, worker_kill_flags, dedup_filter, completed_events)

    port = int(os.environ.get("PORT", 8000))
    config = uvicorn.Config(app, host="0.0.0.0", port=port, log_level="warning")
    server = uvicorn.Server(config)

    tasks = []

    for src in ALL_SOURCES:
        tasks.append(asyncio.create_task(src(queues.input_queue, rate_multiplier)))

    tasks.append(asyncio.create_task(classifier_loop(queues, metrics, strategy, dedup_filter)))
    tasks.append(asyncio.create_task(dedup_purge_loop(dedup_filter, interval=5.0)))

    for i in range(NUM_WORKERS):
        tasks.append(asyncio.create_task(
            worker(i, queues, strategy, metrics, completed_events, worker_kill_flags, dead_letter)
        ))
    tasks.append(asyncio.create_task(completed_events_cleanup(completed_events, ttl=60.0, interval=10.0)))
    tasks.append(asyncio.create_task(kafka_consumer_loop(queues, strategy, interval=0.5)))

    tasks.append(asyncio.create_task(feedback_loop(queues, strategy, metrics, thresholds, interval=3.0)))
    tasks.append(asyncio.create_task(metrics_broadcaster(queues, strategy, metrics, rate_multiplier, app, interval=1.0)))

    if os.environ.get("GEMINI_API_KEY"):
        from jugaadflow.agents.optimizer import optimizer_loop
        from jugaadflow.agents.evaluator import evaluator_loop

        agent_state.agents_enabled = True
        metrics.recent_agent_actions = agent_state.recent_actions

        tasks.append(asyncio.create_task(
            optimizer_loop(thresholds, strategy, queues, metrics, agent_state, interval=30.0)
        ))
        tasks.append(asyncio.create_task(
            evaluator_loop(thresholds, strategy, queues, metrics, agent_state)
        ))
        logger.info("AI agents enabled (optimizer + evaluator) — using Gemini")

        if os.environ.get("TWILIO_ACCOUNT_SID"):
            logger.info("Twilio escalation available (button-only, no auto-calls)")
        else:
            logger.info("Twilio escalation disabled (no TWILIO_ACCOUNT_SID)")
    else:
        logger.info("AI agents disabled (no GEMINI_API_KEY)")

    print("\n  ** JugaadFlow running at http://localhost:8000\n")

    await server.serve()

    # Gracefully cancel all background tasks
    for t in tasks:
        t.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass  # Clean exit on Ctrl+C — no traceback needed
