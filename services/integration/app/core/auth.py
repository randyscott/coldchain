"""
Authentication & authorization — validates Keycloak JWTs.
In development mode (auth_enabled=False), returns a mock user.
"""

import logging
from dataclasses import dataclass
from typing import Optional

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from app.core.config import settings

logger = logging.getLogger(__name__)

security = HTTPBearer(auto_error=False)

# Cache for Keycloak's public keys
_jwks_cache: Optional[dict] = None


@dataclass
class CurrentUser:
    """Represents the authenticated user extracted from the JWT."""
    user_id: str
    email: str
    group_id: str
    role: str  # admin, manager, viewer
    display_name: str


# Dev-mode mock user (matches seed data in init-db.sql)
_MOCK_USER = CurrentUser(
    user_id="b0000000-0000-0000-0000-000000000001",
    email="admin@demo.local",
    group_id="a0000000-0000-0000-0000-000000000001",
    role="admin",
    display_name="Demo Admin",
)


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
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> CurrentUser:
    """
    FastAPI dependency that extracts and validates the current user.
    In dev mode, returns a mock admin user if no token is provided.
    """
    # Dev mode bypass
    if not settings.auth_enabled:
        return _MOCK_USER

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )

    token = credentials.credentials

    try:
        # Fetch Keycloak public keys
        jwks = await _get_jwks()

        # Decode the JWT header to find the key ID
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")

        # Find the matching key
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

        # Verify and decode the token
        payload = jwt.decode(
            token,
            rsa_key,
            algorithms=["RS256"],
            audience=settings.keycloak_client_id,
            issuer=f"{settings.keycloak_url}/realms/{settings.keycloak_realm}",
        )

        # Extract user info from token claims
        # These claims must be configured in Keycloak's client mapper
        return CurrentUser(
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
