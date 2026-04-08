"""
Readings API — Query sensor time-series data.
Supports raw readings and pre-computed aggregates.
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser, get_current_user
from app.core.database import get_db
from app.models.schemas import ReadingOut, ReadingAggregateOut

router = APIRouter(prefix="/readings", tags=["readings"])


@router.get("/device/{device_id}", response_model=list[ReadingOut])
async def get_device_readings(
    device_id: UUID,
    start: datetime | None = Query(None, description="Start time (ISO 8601)"),
    end: datetime | None = Query(None, description="End time (ISO 8601)"),
    limit: int = Query(1000, le=10000),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get raw sensor readings for a device within a time range.
    Defaults to last 24 hours. Max 10,000 rows per request.
    """
    # Verify device belongs to user's group
    device_check = await db.execute(
        text("""
            SELECT d.id FROM devices d
            JOIN systems s ON d.system_id = s.id
            WHERE d.id = :device_id AND s.group_id = :group_id
        """),
        {"device_id": device_id, "group_id": user.group_id},
    )
    if not device_check.first():
        raise HTTPException(status_code=404, detail="Device not found")

    if end is None:
        end = datetime.now(timezone.utc)
    if start is None:
        start = end - timedelta(hours=24)

    result = await db.execute(
        text("""
            SELECT time, device_id, temperature, humidity, battery_voltage,
                   latitude, longitude, rssi, snr
            FROM sensor_readings
            WHERE device_id = :device_id
              AND time >= :start AND time <= :end
            ORDER BY time DESC
            LIMIT :limit
        """),
        {"device_id": device_id, "start": start, "end": end, "limit": limit},
    )
    rows = result.mappings().all()
    return [ReadingOut(**row) for row in rows]


@router.get("/device/{device_id}/hourly", response_model=list[ReadingAggregateOut])
async def get_device_hourly(
    device_id: UUID,
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get hourly aggregated readings (min/max/avg).
    Defaults to last 7 days. Uses TimescaleDB continuous aggregates.
    """
    device_check = await db.execute(
        text("""
            SELECT d.id FROM devices d
            JOIN systems s ON d.system_id = s.id
            WHERE d.id = :device_id AND s.group_id = :group_id
        """),
        {"device_id": device_id, "group_id": user.group_id},
    )
    if not device_check.first():
        raise HTTPException(status_code=404, detail="Device not found")

    if end is None:
        end = datetime.now(timezone.utc)
    if start is None:
        start = end - timedelta(days=7)

    result = await db.execute(
        text("""
            SELECT bucket, device_id,
                   avg_temperature, min_temperature, max_temperature,
                   avg_humidity, min_humidity, max_humidity,
                   reading_count
            FROM sensor_readings_hourly
            WHERE device_id = :device_id
              AND bucket >= :start AND bucket <= :end
            ORDER BY bucket DESC
        """),
        {"device_id": device_id, "start": start, "end": end},
    )
    rows = result.mappings().all()
    return [ReadingAggregateOut(**row) for row in rows]


@router.get("/device/{device_id}/daily", response_model=list[ReadingAggregateOut])
async def get_device_daily(
    device_id: UUID,
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get daily aggregated readings. Defaults to last 90 days.
    """
    device_check = await db.execute(
        text("""
            SELECT d.id FROM devices d
            JOIN systems s ON d.system_id = s.id
            WHERE d.id = :device_id AND s.group_id = :group_id
        """),
        {"device_id": device_id, "group_id": user.group_id},
    )
    if not device_check.first():
        raise HTTPException(status_code=404, detail="Device not found")

    if end is None:
        end = datetime.now(timezone.utc)
    if start is None:
        start = end - timedelta(days=90)

    result = await db.execute(
        text("""
            SELECT bucket, device_id,
                   avg_temperature, min_temperature, max_temperature,
                   avg_humidity, min_humidity, max_humidity,
                   reading_count
            FROM sensor_readings_daily
            WHERE device_id = :device_id
              AND bucket >= :start AND bucket <= :end
            ORDER BY bucket DESC
        """),
        {"device_id": device_id, "start": start, "end": end},
    )
    rows = result.mappings().all()
    return [ReadingAggregateOut(**row) for row in rows]


@router.get("/system/{system_id}/latest", response_model=list[ReadingOut])
async def get_system_latest_readings(
    system_id: UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the most recent reading for every sensor in a system."""
    sys_check = await db.execute(
        text("SELECT id FROM systems WHERE id = :sid AND group_id = :gid"),
        {"sid": system_id, "gid": user.group_id},
    )
    if not sys_check.first():
        raise HTTPException(status_code=404, detail="System not found")

    result = await db.execute(
        text("""
            SELECT DISTINCT ON (sr.device_id)
                sr.time, sr.device_id, sr.temperature, sr.humidity,
                sr.battery_voltage, sr.latitude, sr.longitude,
                sr.rssi, sr.snr
            FROM sensor_readings sr
            JOIN devices d ON sr.device_id = d.id
            WHERE d.system_id = :system_id AND d.is_active = TRUE
            ORDER BY sr.device_id, sr.time DESC
        """),
        {"system_id": system_id},
    )
    rows = result.mappings().all()
    return [ReadingOut(**row) for row in rows]
