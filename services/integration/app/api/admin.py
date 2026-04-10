"""
Platform admin API — cross-group visibility.

All endpoints here require is_platform_admin = TRUE in the database.
The X-As-Group impersonation mechanism is handled transparently by
get_current_user; these endpoints intentionally do NOT use it so that
a platform admin always sees data from all groups regardless of the
X-As-Group header they may have set.
"""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser, require_platform_admin
from app.core.database import get_db
from app.models.schemas import GroupOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/groups", response_model=list[GroupOut])
async def list_all_groups(
    _: CurrentUser = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    """Return every group in the system (platform admin only)."""
    result = await db.execute(
        text("SELECT * FROM groups ORDER BY name")
    )
    return [GroupOut(**row) for row in result.mappings().all()]
