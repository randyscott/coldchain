"""
Auth API — post-login sync endpoint.

POST /auth/sync is called by the frontend once after every Keycloak callback.
It upserts the user row (keycloak_id as the conflict key) so the users table
stays current with Keycloak, and returns the is_platform_admin flag which
cannot be derived from the JWT alone.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser, get_current_user
from app.core.database import get_db
from app.models.schemas import AuthSyncResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/sync", response_model=AuthSyncResponse)
async def auth_sync(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Upsert the authenticated user into the users table and return DB-side flags.

    Called once by the frontend immediately after the Keycloak OIDC callback.
    Fields that come from Keycloak (email, display_name, role) are refreshed on
    every login.  Fields managed in coldchain (is_platform_admin, phone) are
    never overwritten here.

    Returns is_platform_admin so the frontend can show/hide platform-admin UI
    without an extra round-trip on every page load.
    """
    if not user.group_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="JWT is missing group_id claim — user is not assigned to a group in Keycloak.",
        )

    params = {
        "keycloak_id":  user.user_id or None,  # empty string → None
        "group_id":     user.group_id,
        "email":        user.email,
        "display_name": user.display_name,
        "role":         user.role,
    }

    try:
        # Try UPDATE first (covers every login after the first).
        # keycloak_id is only written when non-null so a previously-set value
        # is never clobbered by a missing sub claim.
        result = await db.execute(
            text("""
                UPDATE users SET
                    keycloak_id  = COALESCE(:keycloak_id, keycloak_id),
                    display_name = :display_name,
                    role         = :role,
                    updated_at   = NOW()
                WHERE group_id = CAST(:group_id AS uuid)
                  AND email    = :email
                RETURNING is_platform_admin
            """),
            params,
        )
        row = result.first()

        if row is None:
            # No existing row — first login for this user.
            result = await db.execute(
                text("""
                    INSERT INTO users (keycloak_id, group_id, email, display_name, role)
                    VALUES (
                        :keycloak_id,
                        CAST(:group_id AS uuid),
                        :email,
                        :display_name,
                        :role
                    )
                    RETURNING is_platform_admin
                """),
                params,
            )
            row = result.first()

        await db.commit()
        is_platform_admin = bool(row[0]) if row else False

    except Exception as e:
        await db.rollback()
        # FK violation most likely means group_id from Keycloak doesn't exist in DB.
        # Log it but don't block the user — they can still operate via JWT.
        logger.warning(f"auth/sync upsert failed for {user.email}: {e}")
        is_platform_admin = False

    return AuthSyncResponse(is_platform_admin=is_platform_admin)
