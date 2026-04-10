"""
Users API — view and manage members of the current group.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit_log
from app.core.auth import CurrentUser, get_current_user, require_role
from app.core.database import get_db
from app.models.schemas import UserOut, UserUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserOut])
async def list_users(
    user: CurrentUser = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    """List all users in the current user's group."""
    result = await db.execute(
        text("""
            SELECT * FROM users
            WHERE group_id = :group_id
            ORDER BY display_name
        """),
        {"group_id": user.group_id},
    )
    return [UserOut(**row) for row in result.mappings().all()]


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: UUID,
    body: UserUpdate,
    current_user: CurrentUser = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    Update a user's role, active status, or phone number (admin only).
    An admin cannot change their own role to prevent accidental self-demotion.
    The is_platform_admin flag is never modified here.
    """
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    # Fetch the target user to verify group membership and check for self-edit
    target = await db.execute(
        text("SELECT keycloak_id FROM users WHERE id = :id AND group_id = :gid"),
        {"id": user_id, "gid": current_user.group_id},
    )
    target_row = target.first()
    if not target_row:
        raise HTTPException(status_code=404, detail="User not found")

    if target_row[0] == current_user.user_id and "role" in updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot change your own role.",
        )

    set_clause = ", ".join(f"{k} = :{k}" for k in updates)
    updates["user_id"] = user_id
    updates["group_id"] = current_user.group_id

    result = await db.execute(
        text(f"""
            UPDATE users
            SET {set_clause}, updated_at = NOW()
            WHERE id = :user_id AND group_id = :group_id
            RETURNING *
        """),
        updates,
    )
    await db.commit()
    row = result.mappings().first()
    action = "user.deactivated" if updates.get("is_active") is False \
        else "user.reactivated" if updates.get("is_active") is True \
        else "user.updated"
    await audit_log(db, current_user, action, "user", user_id,
                    {k: v for k, v in body.model_dump(exclude_none=True).items()})
    await db.commit()
    return UserOut(**row)
