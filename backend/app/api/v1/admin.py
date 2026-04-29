import os
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session, func, select

from app.api.v1.auth import get_current_user
from app.db import get_session
from app.models.user import UsageRecord, User


router = APIRouter(prefix="/api/admin", tags=["admin"])
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@admin.ru").lower()


def require_admin(request: Request, session: Annotated[Session, Depends(get_session)]) -> User:
    user = get_current_user(request, session)
    if user.email.lower() != ADMIN_EMAIL:
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    return user


@router.get("/overview")
def overview(
    _: Annotated[User, Depends(require_admin)],
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    users_count = session.exec(select(func.count()).select_from(User)).one()
    usage_count = session.exec(select(func.count()).select_from(UsageRecord)).one()
    plan_rows = session.exec(select(User.plan, func.count()).group_by(User.plan)).all()
    recent_users = session.exec(select(User).order_by(User.created_at.desc()).limit(10)).all()

    return {
        "users_count": users_count,
        "usage_records_count": usage_count,
        "plans": [{"plan": plan, "count": count} for plan, count in plan_rows],
        "recent_users": [
            {
                "id": user.id,
                "email": user.email,
                "plan": user.plan,
                "created_at": user.created_at,
                "updated_at": user.updated_at,
                "payment_provider": user.payment_provider,
                "payment_customer_id": user.payment_customer_id,
                "payment_subscription_id": user.payment_subscription_id,
                "is_active": user.is_active,
            }
            for user in recent_users
        ],
    }
