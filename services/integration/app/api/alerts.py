"""
Alerts API — Manage alert rules and view alert events.
"""

import asyncio
import json
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit_log, get_user_db_id
from app.core.auth import CurrentUser, get_current_user, require_role
from app.core.database import get_db
from app.models.schemas import (
    AlertRuleCreate, AlertRuleUpdate, AlertRuleOut,
    AlertEventOut, AlertAcknowledge,
)

router = APIRouter(prefix="/alerts", tags=["alerts"])

# =========================================================================
# SSE — Server-Sent Events for live alert notifications
# =========================================================================

# Set of active SSE subscriber queues, keyed by group_id for tenant isolation
_subscribers: dict[str, set[asyncio.Queue]] = {}


def publish_alert_event(group_id: str, event: dict):
    """Push an alert event to all SSE subscribers for the given group."""
    queues = _subscribers.get(str(group_id), set())
    for q in queues:
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass


async def _get_sse_user(
    token: str | None = Query(None),
) -> CurrentUser:
    """
    Auth dependency for SSE — EventSource can't send custom headers,
    so the token is accepted as a query parameter as a fallback.
    """
    from fastapi.security import HTTPAuthorizationCredentials

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    return await get_current_user(creds)


@router.get("/stream")
async def alert_stream(
    request: Request,
    user: CurrentUser = Depends(_get_sse_user),
):
    """SSE endpoint — streams alert events to the browser in real time."""
    queue: asyncio.Queue = asyncio.Queue(maxsize=50)
    group_id = str(user.group_id)

    if group_id not in _subscribers:
        _subscribers[group_id] = set()
    _subscribers[group_id].add(queue)

    async def generator():
        try:
            # Send an initial keep-alive comment so the browser knows the stream is open
            yield ": connected\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    # Send keep-alive every 30s to prevent proxy timeouts
                    yield ": keepalive\n\n"
        finally:
            _subscribers.get(group_id, set()).discard(queue)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # Disable Nginx buffering
        },
    )


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
    data["notify_channels"] = json.dumps(data["notify_channels"])

    result = await db.execute(
        text("""
            INSERT INTO alert_rules
                (system_id, device_id, name, description, rule_type, metric,
                 operator, threshold_value, duration_seconds, rate_period_seconds,
                 silence_seconds, notify_channels, escalation_minutes)
            VALUES
                (:system_id, :device_id, :name, :description, :rule_type, :metric,
                 :operator, :threshold_value, :duration_seconds, :rate_period_seconds,
                 :silence_seconds, CAST(:notify_channels AS jsonb), :escalation_minutes)
            RETURNING *
        """),
        data,
    )
    await db.commit()
    row = result.mappings().first()
    await audit_log(db, user, "alert_rule.created", "alert_rule", row["id"],
                    {"name": row["name"], "rule_type": row["rule_type"],
                     "system_id": str(body.system_id)})
    await db.commit()
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
        updates["notify_channels"] = json.dumps(updates["notify_channels"])

    set_clause = ", ".join(
        f"{k} = CAST(:{k} AS jsonb)" if k == "notify_channels" else f"{k} = :{k}"
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
    await audit_log(db, user, "alert_rule.updated", "alert_rule", rule_id,
                    {k: v for k, v in body.model_dump(exclude_none=True).items()})
    await db.commit()
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
    await audit_log(db, user, "alert_rule.deleted", "alert_rule", rule_id, None)
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
    user_db_id = await get_user_db_id(db, user.user_id)

    result = await db.execute(
        text("""
            UPDATE alert_events ae
            SET acknowledged_at = NOW(),
                acknowledged_by = :user_db_id,
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
            "event_id":    event_id,
            "user_db_id":  user_db_id,
            "note":        body.note,
            "group_id":    user.group_id,
        },
    )
    await audit_log(db, user, "alert.acknowledged", "alert_event", event_id,
                    {"note": body.note})
    await db.commit()
    if not result.first():
        raise HTTPException(
            status_code=404,
            detail="Alert event not found or already acknowledged",
        )
    return {"status": "acknowledged"}
