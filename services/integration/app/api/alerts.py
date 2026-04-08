"""
Alerts API — Manage alert rules and view alert events.
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser, get_current_user, require_role
from app.core.database import get_db
from app.models.schemas import (
    AlertRuleCreate, AlertRuleUpdate, AlertRuleOut,
    AlertEventOut, AlertAcknowledge,
)

router = APIRouter(prefix="/alerts", tags=["alerts"])


# =========================================================================
# Alert Rules
# =========================================================================

@router.get("/rules", response_model=list[AlertRuleOut])
async def list_alert_rules(
    system_id: UUID | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    params = {"group_id": user.group_id}
    filters = ["s.group_id = :group_id"]
    if system_id:
        filters.append("ar.system_id = :system_id")
        params["system_id"] = system_id

    where = " AND ".join(filters)
    result = await db.execute(
        text(f"""
            SELECT ar.*
            FROM alert_rules ar
            JOIN systems s ON ar.system_id = s.id
            WHERE {where}
            ORDER BY ar.name
        """),
        params,
    )
    rows = result.mappings().all()
    return [AlertRuleOut(**row) for row in rows]


@router.post("/rules", response_model=AlertRuleOut, status_code=status.HTTP_201_CREATED)
async def create_alert_rule(
    body: AlertRuleCreate,
    user: CurrentUser = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    # Verify system belongs to group
    sys_check = await db.execute(
        text("SELECT id FROM systems WHERE id = :sid AND group_id = :gid"),
        {"sid": body.system_id, "gid": user.group_id},
    )
    if not sys_check.first():
        raise HTTPException(status_code=404, detail="System not found")

    data = body.model_dump()
    data["notify_channels"] = str(data["notify_channels"])  # JSONB

    result = await db.execute(
        text("""
            INSERT INTO alert_rules
                (system_id, device_id, name, description, rule_type, metric,
                 operator, threshold_value, duration_seconds, rate_period_seconds,
                 silence_seconds, notify_channels, escalation_minutes)
            VALUES
                (:system_id, :device_id, :name, :description, :rule_type, :metric,
                 :operator, :threshold_value, :duration_seconds, :rate_period_seconds,
                 :silence_seconds, :notify_channels::jsonb, :escalation_minutes)
            RETURNING *
        """),
        data,
    )
    await db.commit()
    row = result.mappings().first()
    return AlertRuleOut(**row)


@router.patch("/rules/{rule_id}", response_model=AlertRuleOut)
async def update_alert_rule(
    rule_id: UUID,
    body: AlertRuleUpdate,
    user: CurrentUser = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    if "notify_channels" in updates:
        updates["notify_channels"] = str(updates["notify_channels"])

    set_clause = ", ".join(
        f"{k} = :{k}::jsonb" if k == "notify_channels" else f"{k} = :{k}"
        for k in updates
    )
    updates["rule_id"] = rule_id
    updates["group_id"] = user.group_id

    result = await db.execute(
        text(f"""
            UPDATE alert_rules ar SET {set_clause}, updated_at = NOW()
            FROM systems s
            WHERE ar.id = :rule_id AND ar.system_id = s.id AND s.group_id = :group_id
            RETURNING ar.*
        """),
        updates,
    )
    await db.commit()
    row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Alert rule not found")
    return AlertRuleOut(**row)


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_alert_rule(
    rule_id: UUID,
    user: CurrentUser = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
            DELETE FROM alert_rules ar
            USING systems s
            WHERE ar.id = :rule_id AND ar.system_id = s.id AND s.group_id = :group_id
        """),
        {"rule_id": rule_id, "group_id": user.group_id},
    )
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Alert rule not found")


# =========================================================================
# Alert Events
# =========================================================================

@router.get("/events", response_model=list[AlertEventOut])
async def list_alert_events(
    system_id: UUID | None = Query(None),
    active_only: bool = Query(False),
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    limit: int = Query(100, le=1000),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List alert events with optional filters."""
    params: dict = {"group_id": user.group_id, "limit": limit}
    filters = ["s.group_id = :group_id"]

    if system_id:
        filters.append("ar.system_id = :system_id")
        params["system_id"] = system_id
    if active_only:
        filters.append("ae.resolved_at IS NULL")
    if start:
        filters.append("ae.triggered_at >= :start")
        params["start"] = start
    if end:
        filters.append("ae.triggered_at <= :end")
        params["end"] = end

    where = " AND ".join(filters)
    result = await db.execute(
        text(f"""
            SELECT ae.*,
                   ar.name AS rule_name,
                   d.name AS device_name,
                   s.name AS system_name
            FROM alert_events ae
            JOIN alert_rules ar ON ae.alert_rule_id = ar.id
            JOIN devices d ON ae.device_id = d.id
            JOIN systems s ON ar.system_id = s.id
            WHERE {where}
            ORDER BY ae.triggered_at DESC
            LIMIT :limit
        """),
        params,
    )
    rows = result.mappings().all()
    return [AlertEventOut(**row) for row in rows]


@router.post("/events/{event_id}/acknowledge")
async def acknowledge_alert(
    event_id: UUID,
    body: AlertAcknowledge,
    user: CurrentUser = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    """Acknowledge an alert event."""
    result = await db.execute(
        text("""
            UPDATE alert_events ae
            SET acknowledged_at = NOW(),
                acknowledged_by = :user_id,
                acknowledge_note = :note
            FROM alert_rules ar
            JOIN systems s ON ar.system_id = s.id
            WHERE ae.id = :event_id
              AND ae.alert_rule_id = ar.id
              AND s.group_id = :group_id
              AND ae.acknowledged_at IS NULL
            RETURNING ae.id
        """),
        {
            "event_id": event_id,
            "user_id": user.user_id,
            "note": body.note,
            "group_id": user.group_id,
        },
    )
    await db.commit()
    if not result.first():
        raise HTTPException(
            status_code=404,
            detail="Alert event not found or already acknowledged",
        )
    return {"status": "acknowledged"}
