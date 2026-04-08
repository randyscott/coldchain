"""
Devices API — CRUD for gateways and sensors.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser, get_current_user, require_role
from app.core.database import get_db
from app.models.schemas import DeviceCreate, DeviceUpdate, DeviceOut

router = APIRouter(prefix="/devices", tags=["devices"])


@router.get("", response_model=list[DeviceOut])
async def list_devices(
    system_id: UUID | None = Query(None, description="Filter by system"),
    device_type: str | None = Query(None, pattern="^(gateway|sensor)$"),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List devices, optionally filtered by system or type."""
    params = {"group_id": user.group_id}
    filters = ["s.group_id = :group_id"]

    if system_id:
        filters.append("d.system_id = :system_id")
        params["system_id"] = system_id
    if device_type:
        filters.append("d.device_type = :device_type")
        params["device_type"] = device_type

    where = " AND ".join(filters)
    result = await db.execute(
        text(f"""
            SELECT d.*,
                sr.temperature AS latest_temperature,
                sr.humidity AS latest_humidity
            FROM devices d
            JOIN systems s ON d.system_id = s.id
            LEFT JOIN LATERAL (
                SELECT temperature, humidity
                FROM sensor_readings
                WHERE device_id = d.id
                ORDER BY time DESC
                LIMIT 1
            ) sr ON TRUE
            WHERE {where}
            ORDER BY d.name
        """),
        params,
    )
    rows = result.mappings().all()
    return [DeviceOut(**row) for row in rows]


@router.get("/{device_id}", response_model=DeviceOut)
async def get_device(
    device_id: UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
            SELECT d.*,
                sr.temperature AS latest_temperature,
                sr.humidity AS latest_humidity
            FROM devices d
            JOIN systems s ON d.system_id = s.id
            LEFT JOIN LATERAL (
                SELECT temperature, humidity
                FROM sensor_readings
                WHERE device_id = d.id
                ORDER BY time DESC
                LIMIT 1
            ) sr ON TRUE
            WHERE d.id = :device_id AND s.group_id = :group_id
        """),
        {"device_id": device_id, "group_id": user.group_id},
    )
    row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Device not found")
    return DeviceOut(**row)


@router.post("", response_model=DeviceOut, status_code=status.HTTP_201_CREATED)
async def create_device(
    body: DeviceCreate,
    user: CurrentUser = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Register a new device (admin only). System must belong to user's group."""
    # Verify system ownership
    sys_check = await db.execute(
        text("SELECT id FROM systems WHERE id = :sid AND group_id = :gid"),
        {"sid": body.system_id, "gid": user.group_id},
    )
    if not sys_check.first():
        raise HTTPException(status_code=404, detail="System not found")

    try:
        result = await db.execute(
            text("""
                INSERT INTO devices (system_id, dev_eui, device_type,
                                     manufacturer, model, name, description)
                VALUES (:system_id, :dev_eui, :device_type,
                        :manufacturer, :model, :name, :description)
                RETURNING *, NULL::float AS latest_temperature, NULL::float AS latest_humidity
            """),
            body.model_dump(),
        )
        await db.commit()
    except Exception as e:
        await db.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail="Device EUI already registered")
        raise

    from app.services.mqtt_ingestion import invalidate_device_cache
    invalidate_device_cache(body.dev_eui)

    row = result.mappings().first()
    return DeviceOut(**row)


@router.patch("/{device_id}", response_model=DeviceOut)
async def update_device(
    device_id: UUID,
    body: DeviceUpdate,
    user: CurrentUser = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    # If changing system, verify new system belongs to group
    if "system_id" in updates:
        sys_check = await db.execute(
            text("SELECT id FROM systems WHERE id = :sid AND group_id = :gid"),
            {"sid": updates["system_id"], "gid": user.group_id},
        )
        if not sys_check.first():
            raise HTTPException(status_code=404, detail="Target system not found")

    set_clause = ", ".join(f"{k} = :{k}" for k in updates)
    updates["device_id"] = device_id
    updates["group_id"] = user.group_id

    result = await db.execute(
        text(f"""
            UPDATE devices d SET {set_clause}, updated_at = NOW()
            FROM systems s
            WHERE d.id = :device_id AND d.system_id = s.id AND s.group_id = :group_id
            RETURNING d.*, NULL::float AS latest_temperature, NULL::float AS latest_humidity
        """),
        updates,
    )
    await db.commit()
    row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Device not found")

    from app.services.mqtt_ingestion import invalidate_device_cache
    invalidate_device_cache()

    return DeviceOut(**row)
