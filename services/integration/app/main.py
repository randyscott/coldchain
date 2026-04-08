"""
Cold Chain Integration Service
==============================

Main FastAPI application. Starts the HTTP API server and background
services (MQTT subscriber, alert engine connectivity checker).
"""

import asyncio
import logging

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.api import systems, devices, readings, alerts
from app.services.mqtt_ingestion import mqtt_subscriber, shutdown as mqtt_shutdown, set_alert_callback
from app.services.alert_engine import evaluate_reading, connectivity_checker

# Logging
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper()),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage background tasks alongside the FastAPI server."""
    logger.info("🚀 Starting Cold Chain Integration Service")
    logger.info(f"   Environment: {settings.environment}")
    logger.info(f"   Auth enabled: {settings.auth_enabled}")
    logger.info(f"   MQTT broker: {settings.mqtt_host}:{settings.mqtt_port}")

    # Wire up the alert engine to receive readings from the MQTT ingestion
    set_alert_callback(evaluate_reading)

    # Start background tasks
    mqtt_task = asyncio.create_task(mqtt_subscriber())
    connectivity_task = asyncio.create_task(connectivity_checker())

    yield

    # Shutdown
    logger.info("🛑 Shutting down...")
    mqtt_task.cancel()
    connectivity_task.cancel()
    await mqtt_shutdown()

    try:
        await mqtt_task
    except asyncio.CancelledError:
        pass
    try:
        await connectivity_task
    except asyncio.CancelledError:
        pass


# =========================================================================
# Application
# =========================================================================

app = FastAPI(
    title="Cold Chain Compliance Monitoring API",
    description="REST API for the cold chain monitoring system. "
                "Provides access to systems, devices, sensor readings, "
                "and alert management.",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — allow the React frontend to call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",   # React dev server
        "http://localhost:5173",   # Vite dev server
        "http://localhost:8000",   # Same-origin
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API routers
app.include_router(systems.router, prefix="/api/v1")
app.include_router(devices.router, prefix="/api/v1")
app.include_router(readings.router, prefix="/api/v1")
app.include_router(alerts.router, prefix="/api/v1")


@app.get("/health")
async def health_check():
    """Health check endpoint for k3s probes."""
    return {"status": "healthy", "service": "integration"}


@app.get("/api/v1")
async def api_root():
    """API root — lists available endpoints."""
    return {
        "service": "Cold Chain Integration API",
        "version": "0.1.0",
        "endpoints": {
            "systems": "/api/v1/systems",
            "devices": "/api/v1/devices",
            "readings": "/api/v1/readings",
            "alerts": "/api/v1/alerts",
            "docs": "/docs",
        },
    }
