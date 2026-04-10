"""
MQTT Ingestion Service
======================

Subscribes to ChirpStack decoded uplink events via MQTT,
maps device data to the tenant-aware data model, and writes
sensor readings to TimescaleDB.

Runs as a background task alongside the FastAPI server.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone

import asyncpg
from aiomqtt import Client as MqttClient, MqttError

from app.core.config import settings

logger = logging.getLogger(__name__)

# Direct asyncpg connection for high-throughput inserts
# (bypasses SQLAlchemy ORM overhead for the hot path)
_pool: asyncpg.Pool | None = None


def _asyncpg_url() -> str:
    """Convert SQLAlchemy URL to asyncpg format."""
    url = settings.database_url
    url = url.replace("postgresql+asyncpg://", "postgresql://")
    return url


async def _get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            _asyncpg_url(),
            min_size=2,
            max_size=10,
        )
    return _pool


async def _close_pool():
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


# =========================================================================
# Device EUI -> device_id cache (avoids a DB lookup on every reading)
# =========================================================================

_device_cache: dict[str, dict] = {}  # dev_eui -> {id, system_id}


async def _lookup_device(pool: asyncpg.Pool, dev_eui: str) -> dict | None:
    """Look up a device by its DevEUI, with caching."""
    dev_eui_lower = dev_eui.lower()

    if dev_eui_lower in _device_cache:
        return _device_cache[dev_eui_lower]

    row = await pool.fetchrow(
        """
        SELECT d.id, d.system_id, d.name, s.group_id
        FROM devices d
        JOIN systems s ON d.system_id = s.id
        WHERE LOWER(d.dev_eui) = $1 AND d.is_active = TRUE
        """,
        dev_eui_lower,
    )

    if row:
        device_info = {
            "id": row["id"],
            "system_id": row["system_id"],
            "name": row["name"],
            "group_id": row["group_id"],
        }
        _device_cache[dev_eui_lower] = device_info
        return device_info

    return None


def invalidate_device_cache(dev_eui: str = None):
    """Clear device cache — call when devices are added/modified."""
    if dev_eui:
        _device_cache.pop(dev_eui.lower(), None)
    else:
        _device_cache.clear()


# =========================================================================
# Message Processing
# =========================================================================

async def _process_uplink(pool: asyncpg.Pool, topic: str, payload: dict):
    """
    Process a single decoded uplink event from ChirpStack.
    Writes the reading to TimescaleDB and updates device metadata.
    """
    try:
        # Extract device info from the ChirpStack event
        device_info = payload.get("deviceInfo", {})
        dev_eui = device_info.get("devEui", "")
        measurements = payload.get("object", {})

        if not dev_eui:
            logger.warning(f"Uplink missing devEui: {topic}")
            return

        if not measurements:
            logger.debug(f"Uplink has no decoded measurements: {dev_eui}")
            return

        # Look up the device in our database
        device = await _lookup_device(pool, dev_eui)
        if device is None:
            logger.warning(
                f"Unknown device {dev_eui} — not registered in the application. "
                f"Register it via the API or seed data."
            )
            return

        # Parse timestamp
        event_time = payload.get("time")
        if event_time:
            timestamp = datetime.fromisoformat(event_time.replace("Z", "+00:00"))
        else:
            timestamp = datetime.now(timezone.utc)

        # Extract radio metadata
        rx_info = payload.get("rxInfo", [{}])
        best_rx = rx_info[0] if rx_info else {}
        rssi = best_rx.get("rssi")
        snr = best_rx.get("snr")

        # Extract measurements.
        # Log the full object at DEBUG level so field-name issues are easy to diagnose
        # when connecting a new sensor type (e.g. RS26x vs RS1xx field names differ).
        logger.debug(f"Decoded object from {dev_eui}: {measurements}")

        temperature = measurements.get("temperature")
        humidity = measurements.get("humidity")          # None for RS26x (temperature-only)
        battery_voltage = measurements.get("batteryVoltage")
        latitude = measurements.get("latitude")
        longitude = measurements.get("longitude")

        # Deduplication ID
        dedup_id = payload.get("deduplicationId", "")

        # --- Write the reading ---
        await pool.execute(
            """
            INSERT INTO sensor_readings
                (time, device_id, temperature, humidity, battery_voltage,
                 latitude, longitude, rssi, snr, frame_count,
                 raw_payload, chirpstack_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT DO NOTHING
            """,
            timestamp,
            device["id"],
            temperature,
            humidity,
            battery_voltage,
            latitude,
            longitude,
            rssi,
            snr,
            payload.get("fCnt"),
            payload.get("data", ""),
            dedup_id,
        )

        # --- Update device metadata ---
        battery_level = None
        if battery_voltage is not None:
            # Approximate battery level: 3.6V = 100%, 2.0V = 0%
            battery_level = max(0.0, min(1.0, (battery_voltage - 2.0) / 1.6))

        await pool.execute(
            """
            UPDATE devices
            SET last_seen_at = $1,
                battery_level = COALESCE($2, battery_level),
                signal_rssi = COALESCE($3, signal_rssi),
                signal_snr = COALESCE($4, signal_snr),
                updated_at = NOW()
            WHERE id = $5
            """,
            timestamp,
            battery_level,
            rssi,
            snr,
            device["id"],
        )

        logger.info(
            f"📥 {device['name']} ({dev_eui}): "
            f"T={f'{temperature:.2f}°C' if temperature is not None else '—'} "
            f"H={f'{humidity:.1f}%' if humidity is not None else '—'} "
            f"B={f'{battery_voltage:.3f}V' if battery_voltage is not None else '—'} "
            f"RSSI={rssi} SNR={snr}"
        )

        # Return processed data for alert evaluation
        return {
            "device_id": device["id"],
            "system_id": device["system_id"],
            "group_id": device["group_id"],
            "device_name": device["name"],
            "timestamp": timestamp,
            "temperature": temperature,
            "humidity": humidity,
            "battery_voltage": battery_voltage,
        }

    except Exception:
        logger.exception(f"Error processing uplink for topic {topic}")
        return None


# =========================================================================
# Alert evaluation callback — set by the alert engine at startup
# =========================================================================

_alert_callback = None


def set_alert_callback(callback):
    """Register the alert engine's evaluation function."""
    global _alert_callback
    _alert_callback = callback


# =========================================================================
# MQTT Subscriber Loop
# =========================================================================

async def mqtt_subscriber():
    """
    Main MQTT subscription loop. Connects to the broker, subscribes to
    ChirpStack uplink topics, and processes messages as they arrive.
    Reconnects automatically on disconnection.
    """
    pool = await _get_pool()
    topic = settings.mqtt_topic_prefix

    while True:
        try:
            logger.info(
                f"🔌 Connecting to MQTT broker at "
                f"{settings.mqtt_host}:{settings.mqtt_port}..."
            )
            async with MqttClient(
                hostname=settings.mqtt_host,
                port=settings.mqtt_port,
                username=settings.mqtt_username,
                password=settings.mqtt_password,
                identifier="coldchain-integration",
            ) as client:
                await client.subscribe(topic, qos=1)
                logger.info(f"✅ Subscribed to {topic}")

                async for message in client.messages:
                    try:
                        payload = json.loads(message.payload.decode())
                        result = await _process_uplink(
                            pool, str(message.topic), payload
                        )

                        # Evaluate alert rules against this reading
                        if result and _alert_callback:
                            await _alert_callback(result)

                    except json.JSONDecodeError:
                        logger.warning(
                            f"Invalid JSON on {message.topic}: "
                            f"{message.payload[:100]}"
                        )
                    except Exception:
                        logger.exception("Error handling MQTT message")

        except MqttError as e:
            logger.warning(f"MQTT connection lost: {e}. Reconnecting in 5s...")
            await asyncio.sleep(5)
        except Exception:
            logger.exception("Unexpected error in MQTT subscriber. Retrying in 5s...")
            await asyncio.sleep(5)


async def shutdown():
    """Clean up on application shutdown."""
    await _close_pool()
