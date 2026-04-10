"""
Audit logging helper.

Writes structured entries to the audit_log table. Always non-fatal —
errors are logged but never propagate to the caller.

Usage:
    from app.core.audit import audit_log

    await audit_log(
        db=db,
        user=user,
        action="system.created",
        entity_type="system",
        entity_id=row["id"],
        details={"name": row["name"]},
    )
"""

import logging
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser

logger = logging.getLogger(__name__)


async def get_user_db_id(db: AsyncSession, keycloak_id: str) -> UUID | None:
    """Return the DB users.id for a given Keycloak sub. Returns None if not found."""
    if not keycloak_id:
        return None
    try:
        result = await db.execute(
            text("SELECT id FROM users WHERE keycloak_id = :kid"),
            {"kid": keycloak_id},
        )
        row = result.first()
        return row[0] if row else None
    except Exception as e:
        logger.debug(f"audit: could not resolve user DB id for {keycloak_id}: {e}")
        return None


async def audit_log(
    db: AsyncSession,
    user: CurrentUser,
    action: str,
    entity_type: str | None = None,
    entity_id: UUID | str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    """
    Write a single audit log entry.

    action      — dot-namespaced verb, e.g. "system.created", "user.role_changed"
    entity_type — table/resource name, e.g. "system", "device", "alert_rule"
    entity_id   — UUID of the affected row (optional)
    details     — arbitrary JSON context (what changed, old/new values, etc.)
    """
    try:
        import json as _json

        user_db_id = await get_user_db_id(db, user.user_id)

        await db.execute(
            text("""
                INSERT INTO audit_log
                    (group_id, user_id, action, entity_type, entity_id, details)
                VALUES (
                    CAST(:group_id  AS uuid),
                    :user_db_id,
                    :action,
                    :entity_type,
                    :entity_id,
                    CAST(:details AS jsonb)
                )
            """),
            {
                "group_id":    str(user.group_id),
                "user_db_id":  user_db_id,
                "action":      action,
                "entity_type": entity_type,
                "entity_id":   entity_id,
                "details":     _json.dumps(details) if details else None,
            },
        )
        # Note: deliberately NOT committing here — the caller's commit covers this.
        logger.debug(f"audit: {user.email} → {action} {entity_type}:{entity_id}")

    except Exception as e:
        # Audit failure must never break the actual operation.
        logger.warning(f"audit_log write failed ({action}): {e}")
