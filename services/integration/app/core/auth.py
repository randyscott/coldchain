"""
Authentication & authorization — validates Keycloak JWTs.
"""

import logging
from dataclasses import dataclass

import httpx
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db

logger = logging.getLogger(__name__)

security = HTTPBearer()

# Cache for Keycloak's public keys
_jwks_cache: dict | None = None


@dataclass
class CurrentUser:
    """Represents the authenticated user extracted from the JWT."""
    user_id: str
    email: str
    group_id: str
    role: str  # admin, manager, viewer
    display_name: str
    is_platform_admin: bool = False


async def _get_jwks() -> dict:
    """Fetch and cache Keycloak's JWKS (public keys for token verification)."""
    global _jwks_cache
    if _jwks_cache is not None:
        return _jwks_cache

    jwks_url = (
        f"{settings.keycloak_url}/realms/{settings.keycloak_realm}"
        f"/protocol/openid-connect/certs"
    )
    async with httpx.AsyncClient() as client:
        response = await client.get(jwks_url)
        response.raise_for_status()
        _jwks_cache = response.json()
        return _jwks_cache


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    request: Request = None,
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    """FastAPI dependency that extracts and validates the current user from a Keycloak JWT.

    Platform admins may include an X-As-Group header to operate in the context of
    a different group. The DB is checked to verify platform-admin status so the
    header cannot be abused by ordinary users.
    """
    token = credentials.credentials

    # Use public URL for issuer validation — the iss claim in the token reflects the URL
    # the browser used to obtain it, which may differ from the internal Docker service URL.
    issuer_base = settings.keycloak_public_url or settings.keycloak_url

    try:
        jwks = await _get_jwks()

        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")

        rsa_key = None
        for key in jwks.get("keys", []):
            if key["kid"] == kid:
                rsa_key = key
                break

        if rsa_key is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Unable to find appropriate key",
            )

        payload = jwt.decode(
            token,
            rsa_key,
            algorithms=["RS256"],
            audience=settings.keycloak_client_id,
            issuer=f"{issuer_base}/realms/{settings.keycloak_realm}",
        )

        # These claims are injected by the Keycloak protocol mappers configured in the realm.
        user = CurrentUser(
            user_id=payload.get("sub", ""),
            email=payload.get("email", ""),
            group_id=payload.get("group_id", ""),
            role=payload.get("role", "viewer"),
            display_name=payload.get("preferred_username", ""),
        )

    except JWTError as e:
        logger.warning(f"JWT validation failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
        )
    except httpx.HTTPError as e:
        logger.error(f"Failed to fetch JWKS from Keycloak: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service unavailable",
        )

    # Handle X-As-Group impersonation for platform admins.
    # The DB check here is intentional — is_platform_admin cannot be forged via JWT.
    as_group = request.headers.get("X-As-Group") if request else None
    if as_group:
        result = await db.execute(
            text("SELECT is_platform_admin FROM users WHERE keycloak_id = :kid"),
            {"kid": user.user_id},
        )
        row = result.first()
        if not row or not row[0]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="X-As-Group header requires platform admin privileges",
            )
        # Verify the target group exists
        grp = await db.execute(
            text("SELECT id FROM groups WHERE id = CAST(:gid AS uuid)"),
            {"gid": as_group},
        )
        if not grp.first():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")

        user.group_id = as_group
        user.role = "admin"          # platform admin gets full access in the target group
        user.is_platform_admin = True

    return user


def require_role(*allowed_roles: str):
    """
    Returns a dependency that checks the user has one of the allowed roles.
    Usage: Depends(require_role("admin", "manager"))
    """
    async def check_role(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires one of roles: {', '.join(allowed_roles)}",
            )
        return user
    return check_role


async def require_platform_admin(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    """
    Dependency that verifies the caller is a platform admin.
    Performs a DB lookup so the flag cannot be forged via a crafted JWT.
    Usage: user: CurrentUser = Depends(require_platform_admin)
    """
    result = await db.execute(
        text("SELECT is_platform_admin FROM users WHERE keycloak_id = :kid"),
        {"kid": user.user_id},
    )
    row = result.first()
    if not row or not row[0]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Platform admin access required",
        )
    user.is_platform_admin = True
    return user
