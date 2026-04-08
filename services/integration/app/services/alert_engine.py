"""
Alert Engine
============

Evaluates incoming sensor readings against configured alert rules.
Manages alert lifecycle: trigger, sustain, resolve, notify.
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from uuid import UUID

import asyncpg

from app.core.config import settings
from app.services.notifications import send_alert_notification

logger = logging.getLogger(__name__)

# Track active excursions: (rule_id, device_id) -> first_breach_time
_active_breaches: dict[tuple[UUID, UUID], datetime] = {}

# Track triggered alerts: (rule_id, device_id) -> alert_event_id
_triggered_alerts: dict[tuple[UUID, UUID], UUID] = {}

# Cache of alert rules, refreshed periodically
_rules_cache: list[dict] = []
_rules_cache_time: datetime | None = None
_RULES_CACHE_TTL = timedelta(seconds=30)


async def _refresh_rules(pool: asyncpg.Pool):
    """Load active alert rules from the database."""
    global _rules_cache, _rules_cache_time

    now = datetime.now(timezone.utc)
    if _rules_cache_time and (now - _rules_cache_time) < _RULES_CACHE_TTL:
        return

    rows = await pool.fetch(
        """
        SELECT ar.*, s.group_id
        FROM alert_rules ar
        JOIN systems s ON ar.system_id = s.id
        WHERE ar.is_active = TRUE
        """
    )
    _rules_cache = [dict(r) for r in rows]
    _rules_cache_time = now
    logger.debug(f"Refreshed alert rules cache: {len(_rules_cache)} rules")


def _check_threshold(value: float, operator: str, threshold: float) -> bool:
    """Evaluate a threshold condition."""
    if operator == "gt":
        return value > threshold
    elif operator == "gte":
        return value >= threshold
    elif operator == "lt":
        return value < threshold
    elif operator == "lte":
        return value <= threshold
    return False


async def evaluate_reading(reading: dict):
    """
    Evaluate a single sensor reading against all applicable alert rules.
    Called by the MQTT ingestion service for each new reading.
    """
    from app.services.mqtt_ingestion import _get_pool

    pool = await _get_pool()
    await _refresh_rules(pool)

    device_id = reading["device_id"]
    system_id = reading["system_id"]

    for rule in _rules_cache:
        # Rule applies to this device? (device-specific or system-wide)
        if rule["device_id"] is not None and rule["device_id"] != device_id:
            continue
        if rule["system_id"] != system_id:
            continue

        # Skip connectivity and battery rules here (handled by periodic checks)
        if rule["rule_type"] in ("connectivity", "battery"):
            if rule["rule_type"] == "battery" and reading.get("battery_voltage") is not None:
                await _evaluate_battery_rule(pool, rule, reading)
            continue

        # Get the metric value
        metric = rule["metric"]
        value = reading.get(metric)
        if value is None:
            continue

        key = (rule["id"], device_id)
        breached = _check_threshold(value, rule["operator"], rule["threshold_value"])

        if breached:
            await _handle_breach(pool, rule, reading, key, value)
        else:
            await _handle_recovery(pool, rule, key)


async def _handle_breach(
    pool: asyncpg.Pool, rule: dict, reading: dict,
    key: tuple, value: float
):
    """Handle a threshold breach for a reading."""
    now = datetime.now(timezone.utc)

    if key not in _active_breaches:
        # First breach — start tracking
        _active_breaches[key] = now
        logger.debug(
            f"Breach started: {rule['name']} on {reading['device_name']} "
            f"({value} {rule['operator']} {rule['threshold_value']})"
        )

    # Check if breach has persisted long enough (duration-based rules)
    breach_start = _active_breaches[key]
    breach_duration = (now - breach_start).total_seconds()

    if breach_duration >= rule["duration_seconds"] and key not in _triggered_alerts:
        # Trigger the alert
        alert_id = await _create_alert_event(pool, rule, reading, value)
        _triggered_alerts[key] = alert_id

        logger.warning(
            f"🚨 ALERT TRIGGERED: {rule['name']} on {reading['device_name']} — "
            f"{value} {rule['operator']} {rule['threshold_value']} "
            f"for {breach_duration:.0f}s"
        )

        # Send notifications
        await send_alert_notification(
            rule=rule,
            reading=reading,
            trigger_value=value,
            alert_event_id=alert_id,
        )

    elif key in _triggered_alerts:
        # Alert already triggered — update peak value
        await pool.execute(
            """
            UPDATE alert_events
            SET peak_value = CASE
                WHEN $1 > COALESCE(peak_value, $1) AND $3 IN ('gt', 'gte') THEN $1
                WHEN $1 < COALESCE(peak_value, $1) AND $3 IN ('lt', 'lte') THEN $1
                ELSE peak_value
            END
            WHERE id = $2
            """,
            value,
            _triggered_alerts[key],
            rule["operator"],
        )


async def _handle_recovery(pool: asyncpg.Pool, rule: dict, key: tuple):
    """Handle when a reading returns to normal range."""
    if key in _active_breaches:
        del _active_breaches[key]

    if key in _triggered_alerts:
        # Resolve the alert
        alert_id = _triggered_alerts.pop(key)
        await pool.execute(
            """
            UPDATE alert_events SET resolved_at = NOW() WHERE id = $1
            """,
            alert_id,
        )
        logger.info(f"✅ Alert resolved: {rule['name']} (event {alert_id})")


async def _evaluate_battery_rule(pool: asyncpg.Pool, rule: dict, reading: dict):
    """Evaluate battery-level alert rules."""
    voltage = reading.get("battery_voltage")
    if voltage is None:
        return

    key = (rule["id"], reading["device_id"])
    breached = _check_threshold(voltage, rule["operator"], rule["threshold_value"])

    if breached and key not in _triggered_alerts:
        alert_id = await _create_alert_event(pool, rule, reading, voltage)
        _triggered_alerts[key] = alert_id
        logger.warning(
            f"🔋 BATTERY ALERT: {rule['name']} on {reading['device_name']} — "
            f"{voltage}V"
        )
        await send_alert_notification(
            rule=rule, reading=reading,
            trigger_value=voltage, alert_event_id=alert_id,
        )
    elif not breached and key in _triggered_alerts:
        alert_id = _triggered_alerts.pop(key)
        await pool.execute(
            "UPDATE alert_events SET resolved_at = NOW() WHERE id = $1",
            alert_id,
        )


async def _create_alert_event(
    pool: asyncpg.Pool, rule: dict, reading: dict, trigger_value: float
) -> UUID:
    """Insert a new alert event and return its ID."""
    row = await pool.fetchrow(
        """
        INSERT INTO alert_events
            (alert_rule_id, device_id, triggered_at, trigger_value, peak_value)
        VALUES ($1, $2, NOW(), $3, $3)
        RETURNING id
        """,
        rule["id"],
        reading["device_id"],
        trigger_value,
    )
    return row["id"]


# =========================================================================
# Periodic Connectivity Check
# =========================================================================

async def connectivity_checker():
    """
    Periodically checks for sensors that have stopped reporting.
    Runs as a background task alongside the MQTT subscriber.
    """
    from app.services.mqtt_ingestion import _get_pool

    # Wait for startup
    await asyncio.sleep(10)

    while True:
        try:
            pool = await _get_pool()
            await _refresh_rules(pool)

            connectivity_rules = [
                r for r in _rules_cache if r["rule_type"] == "connectivity"
            ]

            for rule in connectivity_rules:
                silence = rule.get("silence_seconds", 1800) or 1800
                cutoff = datetime.now(timezone.utc) - timedelta(seconds=silence)

                # Find devices in this system that haven't reported
                if rule["device_id"]:
                    # Device-specific rule
                    rows = await pool.fetch(
                        """
                        SELECT id, name, last_seen_at
                        FROM devices
                        WHERE id = $1 AND is_active = TRUE
                          AND (last_seen_at IS NULL OR last_seen_at < $2)
                        """,
                        rule["device_id"], cutoff,
                    )
                else:
                    # System-wide rule
                    rows = await pool.fetch(
                        """
                        SELECT id, name, last_seen_at
                        FROM devices
                        WHERE system_id = $1
                          AND device_type = 'sensor'
                          AND is_active = TRUE
                          AND (last_seen_at IS NULL OR last_seen_at < $2)
                        """,
                        rule["system_id"], cutoff,
                    )

                for device in rows:
                    key = (rule["id"], device["id"])
                    if key not in _triggered_alerts:
                        alert_id = await _create_alert_event(
                            pool, rule,
                            {
                                "device_id": device["id"],
                                "system_id": rule["system_id"],
                                "group_id": rule["group_id"],
                                "device_name": device["name"],
                            },
                            0,
                        )
                        _triggered_alerts[key] = alert_id
                        logger.warning(
                            f"📡 CONNECTIVITY ALERT: {device['name']} "
                            f"last seen {device['last_seen_at']}"
                        )

        except Exception:
            logger.exception("Error in connectivity checker")

        await asyncio.sleep(settings.connectivity_check_interval_seconds)
