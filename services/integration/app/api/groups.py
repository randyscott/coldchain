"""
Groups API — read and update the current user's group (tenant) settings.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit_log
from app.core.auth import CurrentUser, require_role
from app.core.database import get_db
from app.models.schemas import GroupOut, GroupUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/groups", tags=["groups"])


@router.get("/me", response_model=GroupOut)
async def get_my_group(
    user: CurrentUser = Depends(require_role("admin", "manager", "viewer")),
    db: AsyncSession = Depends(get_db),
):
    """Return the current user's group (tenant) record."""
    result = await db.execute(
        text("SELECT * FROM groups WHERE id = :id"),
        {"id": user.group_id},
    )
    row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Group not found")
    return GroupOut(**row)


@router.patch("/me", response_model=GroupOut)
async def update_my_group(
    body: GroupUpdate,
    user: CurrentUser = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Update the current group's display name (admin only)."""
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clause = ", ".join(f"{k} = :{k}" for k in updates)
    updates["group_id"] = user.group_id

    result = await db.execute(
        text(f"""
            UPDATE groups
            SET {set_clause}, updated_at = NOW()
            WHERE id = :group_id
            RETURNING *
        """),
        updates,
    )
    await db.commit()
    row = result.mappings().first()
    await audit_log(db, user, "group.updated", "group", user.group_id,
                    body.model_dump(exclude_none=True))
    await db.commit()
    return GroupOut(**row)
