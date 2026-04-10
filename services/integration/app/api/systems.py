"""
Systems API — CRUD for monitoring systems (locations/vehicles).
All queries are scoped to the authenticated user's group.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit_log
from app.core.auth import CurrentUser, get_current_user, require_role
from app.core.database import get_db
from app.models.schemas import (
    SystemCreate, SystemUpdate, SystemOut, SystemSummary,
)
from app.services.chirpstack_client import get_chirpstack_client, ChirpStackError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/systems", tags=["systems"])


@router.get("", response_model=list[SystemOut])
async def list_systems(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all systems belonging to the user's group."""
    result = await db.execute(
        text("""
            SELECT s.*,
                COUNT(DISTINCT CASE WHEN d.device_type = 'sensor' THEN d.id END) AS sensor_count,
                COUNT(DISTINCT CASE WHEN d.device_type = 'gateway' THEN d.id END) AS gateway_count,
                COUNT(DISTINCT CASE WHEN ae.resolved_at IS NULL THEN ae.id END) AS active_alert_count
            FROM systems s
            LEFT JOIN devices d ON d.system_id = s.id AND d.is_active = TRUE
            LEFT JOIN alert_events ae ON ae.device_id = d.id AND ae.resolved_at IS NULL
            WHERE s.group_id = :group_id
            GROUP BY s.id
            ORDER BY s.name
        """),
        {"group_id": user.group_id},
    )
    rows = result.mappings().all()
    return [SystemOut(**row) for row in rows]


@router.get("/summary", response_model=list[SystemSummary])
async def get_dashboard_summary(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Dashboard summary: status of all systems at a glance."""
    result = await db.execute(
        text("""
            WITH device_status AS (
                SELECT
                    d.system_id,
                    d.id AS device_id,
                    d.name AS device_name,
                    d.device_type,
                    d.last_seen_at,
                    sr.temperature AS latest_temp
                FROM devices d
                LEFT JOIN LATERAL (
                    SELECT temperature
                    FROM sensor_readings
                    WHERE device_id = d.id
                    ORDER BY time DESC
                    LIMIT 1
                ) sr ON TRUE
                WHERE d.is_active = TRUE
            )
            SELECT
                s.id AS system_id,
                s.name AS system_name,
                s.system_type,
                COUNT(DISTINCT CASE WHEN ds.device_type = 'sensor' THEN ds.device_id END) AS sensor_count,
                COUNT(DISTINCT CASE WHEN ds.device_type = 'gateway' THEN ds.device_id END) AS gateway_count,
                COUNT(DISTINCT CASE WHEN ae.resolved_at IS NULL THEN ae.id END) AS active_alerts,
                COUNT(DISTINCT CASE
                    WHEN ds.device_type = 'sensor'
                     AND ds.last_seen_at > NOW() - INTERVAL '15 minutes'
                    THEN ds.device_id
                END) AS sensors_reporting,
                -- Worst temperature: furthest from the midpoint of typical range
                MAX(ds.latest_temp) AS worst_temperature,
                MAX(ds.last_seen_at) AS last_reading_at
            FROM systems s
            LEFT JOIN device_status ds ON ds.system_id = s.id
            LEFT JOIN alert_events ae ON ae.device_id = ds.device_id AND ae.resolved_at IS NULL
            WHERE s.group_id = :group_id AND s.is_active = TRUE
            GROUP BY s.id, s.name, s.system_type
            ORDER BY s.name
        """),
        {"group_id": user.group_id},
    )
    rows = result.mappings().all()
    return [
        SystemSummary(
            **{k: v for k, v in row.items() if k != "worst_sensor_name"},
            worst_sensor_name=None,  # TODO: add subquery for this
        )
        for row in rows
    ]


@router.get("/{system_id}", response_model=SystemOut)
async def get_system(
    system_id: UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single system by ID (must belong to user's group)."""
    result = await db.execute(
        text("""
            SELECT s.*,
                COUNT(DISTINCT CASE WHEN d.device_type = 'sensor' THEN d.id END) AS sensor_count,
                COUNT(DISTINCT CASE WHEN d.device_type = 'gateway' THEN d.id END) AS gateway_count,
                COUNT(DISTINCT CASE WHEN ae.resolved_at IS NULL THEN ae.id END) AS active_alert_count
            FROM systems s
            LEFT JOIN devices d ON d.system_id = s.id AND d.is_active = TRUE
            LEFT JOIN alert_events ae ON ae.device_id = d.id AND ae.resolved_at IS NULL
            WHERE s.id = :system_id AND s.group_id = :group_id
            GROUP BY s.id
        """),
        {"system_id": system_id, "group_id": user.group_id},
    )
    row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="System not found")
    return SystemOut(**row)


@router.post("", response_model=SystemOut, status_code=status.HTTP_201_CREATED)
async def create_system(
    body: SystemCreate,
    user: CurrentUser = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Create a new system in coldchain and a corresponding ChirpStack application."""
    # Create the ChirpStack application first so we have the ID to store
    cs_app_id = None
    try:
        async with get_chirpstack_client() as cs:
            cs_app_id = await cs.create_application(
                name=body.name,
                description=body.description or "",
            )
    except ChirpStackError as e:
        logger.error(f"ChirpStack application creation failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to create ChirpStack application: {e}",
        )

    result = await db.execute(
        text("""
            INSERT INTO systems (group_id, name, description, system_type,
                                 address, latitude, longitude, timezone,
                                 chirpstack_application_id)
            VALUES (:group_id, :name, :description, :system_type,
                    :address, :latitude, :longitude, :timezone,
                    :chirpstack_application_id)
            RETURNING *, 0 AS sensor_count, 0 AS gateway_count, 0 AS active_alert_count
        """),
        {"group_id": user.group_id, "chirpstack_application_id": cs_app_id, **body.model_dump()},
    )
    await db.commit()
    row = result.mappings().first()
    await audit_log(db, user, "system.created", "system", row["id"], {"name": row["name"]})
    await db.commit()
    return SystemOut(**row)


@router.patch("/{system_id}", response_model=SystemOut)
async def update_system(
    system_id: UUID,
    body: SystemUpdate,
    user: CurrentUser = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Update a system (admin only). Syncs name/description to ChirpStack if changed."""
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clause = ", ".join(f"{k} = :{k}" for k in updates)
    updates["system_id"] = system_id
    updates["group_id"] = user.group_id

    result = await db.execute(
        text(f"""
            UPDATE systems SET {set_clause}, updated_at = NOW()
            WHERE id = :system_id AND group_id = :group_id
            RETURNING *, 0 AS sensor_count, 0 AS gateway_count, 0 AS active_alert_count
        """),
        updates,
    )
    await db.commit()
    row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="System not found")

    await audit_log(db, user, "system.updated", "system", system_id,
                    {k: v for k, v in body.model_dump(exclude_none=True).items()})
    await db.commit()

    # Sync name/description changes to ChirpStack if the system has an application
    cs_app_id = row.get("chirpstack_application_id")
    if cs_app_id and ("name" in updates or "description" in updates):
        try:
            async with get_chirpstack_client() as cs:
                await cs.update_application(
                    cs_app_id=cs_app_id,
                    name=row["name"],
                    description=row.get("description") or "",
                )
        except ChirpStackError as e:
            # Log but don't fail — the DB update already succeeded
            logger.warning(f"ChirpStack application update failed for {cs_app_id}: {e}")

    return SystemOut(**row)


@router.delete("/{system_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_system(
    system_id: UUID,
    user: CurrentUser = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    Delete a system (admin only). Also deletes the corresponding ChirpStack
    application, which cascades to all devices registered under it in ChirpStack.
    """
    # Fetch chirpstack_application_id before deleting
    row = await db.execute(
        text("SELECT chirpstack_application_id FROM systems WHERE id = :id AND group_id = :gid"),
        {"id": system_id, "gid": user.group_id},
    )
    system = row.mappings().first()
    if not system:
        raise HTTPException(status_code=404, detail="System not found")

    cs_app_id = system.get("chirpstack_application_id")

    # Delete from coldchain DB (cascades to devices and alert rules)
    await db.execute(
        text("DELETE FROM systems WHERE id = :id AND group_id = :gid"),
        {"id": system_id, "gid": user.group_id},
    )
    await audit_log(db, user, "system.deleted", "system", system_id,
                    {"chirpstack_application_id": cs_app_id})
    await db.commit()

    # Delete from ChirpStack (best-effort — don't fail if already gone)
    if cs_app_id:
        try:
            async with get_chirpstack_client() as cs:
                await cs.delete_application(cs_app_id)
        except ChirpStackError as e:
            logger.warning(f"ChirpStack application deletion failed for {cs_app_id}: {e}")
