"""
Devices API — CRUD for gateways and sensors.
All write operations that register a device also sync with ChirpStack.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser, get_current_user, require_role
from app.core.database import get_db
from app.models.schemas import DeviceCreate, DeviceUpdate, DeviceOut, DeviceProfileCreate, DeviceProfileOut
from app.services.chirpstack_client import get_chirpstack_client, ChirpStackError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/devices", tags=["devices"])


@router.get("/profiles", response_model=list[DeviceProfileOut])
async def list_device_profiles(
    user: CurrentUser = Depends(get_current_user),
):
    """Return all device profiles available in ChirpStack for this tenant."""
    try:
        async with get_chirpstack_client() as cs:
            profiles = await cs.list_device_profiles()
        return [
            DeviceProfileOut(
                id=p.id,
                name=p.name,
                description=p.description or None,
                region=p.region,
                mac_version=p.mac_version,
                reg_params_revision=p.reg_params_revision,
                supports_otaa=p.supports_otaa,
                supports_class_b=p.supports_class_b,
                supports_class_c=p.supports_class_c,
            )
            for p in profiles
        ]
    except ChirpStackError as e:
        logger.error(f"Failed to fetch device profiles from ChirpStack: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not reach ChirpStack: {e}",
        )


@router.post("/profiles", response_model=DeviceProfileOut, status_code=status.HTTP_201_CREATED)
async def create_device_profile(
    body: DeviceProfileCreate,
    user: CurrentUser = Depends(require_role("admin")),
):
    """
    Create a new device profile in ChirpStack (admin only).

    Common region values: EU868, US915, AU915, AS923, IN865
    Common mac_version values: LORAWAN_1_0_3, LORAWAN_1_0_4, LORAWAN_1_1_0
    Common reg_params_revision values: RP002_1_0_3, RP002_1_0_4, RP002_1_0_5
    """
    try:
        async with get_chirpstack_client() as cs:
            profile_id = await cs.create_device_profile(
                name=body.name,
                region=body.region,
                mac_version=body.mac_version,
                reg_params_revision=body.reg_params_revision,
                description=body.description or "",
                supports_otaa=body.supports_otaa,
                supports_class_b=body.supports_class_b,
                supports_class_c=body.supports_class_c,
                uplink_interval=body.uplink_interval,
                flush_queue_on_activate=body.flush_queue_on_activate,
                device_status_req_interval=body.device_status_req_interval,
                adr_algorithm_id=body.adr_algorithm_id,
            )
    except ChirpStackError as e:
        logger.error(f"ChirpStack device profile creation failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to create device profile in ChirpStack: {e}",
        )

    return DeviceProfileOut(
        id=profile_id,
        name=body.name,
        description=body.description,
        region=body.region,
        mac_version=body.mac_version,
        reg_params_revision=body.reg_params_revision,
        supports_otaa=body.supports_otaa,
        supports_class_b=body.supports_class_b,
        supports_class_c=body.supports_class_c,
    )


@router.delete("/profiles/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_device_profile(
    profile_id: str,
    user: CurrentUser = Depends(require_role("admin")),
):
    """Delete a device profile from ChirpStack (admin only)."""
    try:
        async with get_chirpstack_client() as cs:
            await cs.delete_device_profile(profile_id)
    except ChirpStackError as e:
        logger.error(f"ChirpStack device profile deletion failed for {profile_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to delete device profile: {e}",
        )


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
    """
    Register a new device (admin only).
    For sensors with a device_profile_id: also creates the device in ChirpStack and
    optionally sets the OTAA AppKey if app_key is provided.
    For gateways: registers the gateway in ChirpStack using the dev_eui as gateway_id.
    """
    # Verify system ownership and fetch chirpstack_application_id
    sys_row = await db.execute(
        text("SELECT id, chirpstack_application_id FROM systems WHERE id = :sid AND group_id = :gid"),
        {"sid": body.system_id, "gid": user.group_id},
    )
    system = sys_row.mappings().first()
    if not system:
        raise HTTPException(status_code=404, detail="System not found")

    cs_app_id = system.get("chirpstack_application_id")

    # --- ChirpStack registration (best-effort for sensors, required for gateways) ---
    if body.device_type == "sensor" and body.device_profile_id and cs_app_id:
        try:
            async with get_chirpstack_client() as cs:
                await cs.create_device(
                    cs_app_id=cs_app_id,
                    dev_eui=body.dev_eui,
                    name=body.name,
                    device_profile_id=body.device_profile_id,
                    description=body.description or "",
                    join_eui=body.app_eui or "",
                )
                if body.app_key:
                    await cs.set_device_otaa_keys(dev_eui=body.dev_eui, app_key=body.app_key)
        except ChirpStackError as e:
            logger.error(f"ChirpStack device registration failed for {body.dev_eui}: {e}")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Failed to register device in ChirpStack: {e}",
            )
    elif body.device_type == "gateway":
        try:
            async with get_chirpstack_client() as cs:
                await cs.create_gateway(
                    gateway_id=body.dev_eui,
                    name=body.name,
                    description=body.description or "",
                )
        except ChirpStackError as e:
            logger.error(f"ChirpStack gateway registration failed for {body.dev_eui}: {e}")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Failed to register gateway in ChirpStack: {e}",
            )

    # --- Insert into coldchain DB ---
    db_params = body.model_dump(exclude={"app_key", "app_eui"})  # OTAA secrets not stored in DB
    db_params["chirpstack_device_profile_id"] = body.device_profile_id

    try:
        result = await db.execute(
            text("""
                INSERT INTO devices (system_id, dev_eui, device_type,
                                     manufacturer, model, name, description,
                                     chirpstack_device_profile_id)
                VALUES (:system_id, :dev_eui, :device_type,
                        :manufacturer, :model, :name, :description,
                        :chirpstack_device_profile_id)
                RETURNING *, NULL::float AS latest_temperature, NULL::float AS latest_humidity
            """),
            db_params,
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


@router.delete("/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_device(
    device_id: UUID,
    user: CurrentUser = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    Delete a device (admin only).
    Also removes the corresponding record from ChirpStack (best-effort).
    For sensors: calls ChirpStack DeleteDevice.
    For gateways: calls ChirpStack DeleteGateway (using dev_eui as gateway_id).
    """
    # Fetch device info before deleting
    row = await db.execute(
        text("""
            SELECT d.dev_eui, d.device_type
            FROM devices d
            JOIN systems s ON d.system_id = s.id
            WHERE d.id = :id AND s.group_id = :gid
        """),
        {"id": device_id, "gid": user.group_id},
    )
    device = row.mappings().first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    dev_eui = device["dev_eui"]
    device_type = device["device_type"]

    # Delete from coldchain DB (cascades to alert rules / events)
    await db.execute(
        text("DELETE FROM devices WHERE id = :id"),
        {"id": device_id},
    )
    await db.commit()

    from app.services.mqtt_ingestion import invalidate_device_cache
    invalidate_device_cache(dev_eui)

    # Best-effort removal from ChirpStack
    try:
        async with get_chirpstack_client() as cs:
            if device_type == "gateway":
                await cs.delete_gateway(dev_eui)
            else:
                await cs.delete_device(dev_eui)
    except ChirpStackError as e:
        logger.warning(f"ChirpStack deletion failed for {dev_eui} ({device_type}): {e}")
