import os
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlmodel import Session, func, select

from app.api.v1.auth import get_current_user
from app.db import get_session
from app.models.user import UsageRecord, User
from app.services.email_service import send_plan_activated_email
from app.services.quota import apply_early_renewal
from app.services.subscription_reminders import send_due_subscription_reminders


router = APIRouter(prefix="/api/admin", tags=["admin"])
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@admin.ru").lower()
ALLOWLIST_PATH = Path(__file__).resolve().parents[2] / "data" / "global_allowlist.json"


class AllowlistPayload(BaseModel):
    terms: list[str] = Field(default_factory=list, max_length=2000)


class UserPlanPayload(BaseModel):
    email: str = Field(..., min_length=3, max_length=320)
    plan: str = Field(default="agency_m", pattern="^(free|freelancer|agency_s|agency_m|one_time)$")
    days: int | None = Field(default=None, ge=1, le=3660)


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


@router.post("/subscription-reminders/send")
def send_subscription_reminders_now(
    _: Annotated[User, Depends(require_admin)],
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    return send_due_subscription_reminders(session)


@router.get("/users")
def list_users(
    _: Annotated[User, Depends(require_admin)],
    session: Annotated[Session, Depends(get_session)],
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    search: str = Query(default="", max_length=320),
) -> dict:
    query = select(User)
    count_query = select(func.count()).select_from(User)
    search_value = search.strip().lower()
    if search_value:
        pattern = f"%{search_value}%"
        query = query.where(User.email.ilike(pattern))
        count_query = count_query.where(User.email.ilike(pattern))

    total = session.exec(count_query).one()
    users = session.exec(
        query.order_by(User.created_at.desc()).offset((page - 1) * limit).limit(limit)
    ).all()
    return {
        "items": [
            {
                "id": user.id,
                "email": user.email,
                "plan": user.plan,
                "plan_expires_at": user.plan_expires_at,
                "oauth_provider": user.oauth_provider,
                "oauth_email_placeholder": user.oauth_email_placeholder,
                "created_at": user.created_at,
                "updated_at": user.updated_at,
                "is_active": user.is_active,
            }
            for user in users
        ],
        "page": page,
        "limit": limit,
        "total": total,
        "pages": max(1, (total + limit - 1) // limit),
    }


@router.post("/users/plan")
def update_user_plan(
    payload: UserPlanPayload,
    background_tasks: BackgroundTasks,
    _: Annotated[User, Depends(require_admin)],
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    email = payload.email.strip().lower()
    user = session.exec(select(User).where(User.email == email)).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь с такой почтой не найден. Сначала он должен зарегистрироваться или войти через OAuth.")

    new_expires_at = datetime.utcnow() + timedelta(days=payload.days) if payload.days else None
    if user.plan == payload.plan and user.plan_expires_at and new_expires_at and user.plan_expires_at > datetime.utcnow():
        apply_early_renewal(
            session=session,
            user_id=user.id,
            plan=user.plan,
            old_expires_at=user.plan_expires_at,
            new_expires_at=new_expires_at,
            started_at=user.created_at,
        )
    user.plan = payload.plan
    user.plan_expires_at = new_expires_at
    user.updated_at = datetime.utcnow()
    session.add(user)
    session.commit()
    session.refresh(user)
    background_tasks.add_task(send_plan_activated_email, user.email, user.plan, user.plan_expires_at)
    return {
        "id": user.id,
        "email": user.email,
        "plan": user.plan,
        "plan_expires_at": user.plan_expires_at,
        "updated_at": user.updated_at,
    }


def _read_allowlist() -> list[str]:
    if not ALLOWLIST_PATH.exists():
        return []
    try:
        raw = json.loads(ALLOWLIST_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    return [
        " ".join(str(item).split())
        for item in raw.get("terms", [])
        if " ".join(str(item).split())
    ]


@router.get("/allowlist")
def get_allowlist(_: Annotated[User, Depends(require_admin)], response: Response) -> dict:
    response.headers["Cache-Control"] = "no-store"
    return {"terms": _read_allowlist()}


@router.put("/allowlist")
def update_allowlist(
    payload: AllowlistPayload,
    _: Annotated[User, Depends(require_admin)],
    response: Response,
) -> dict:
    response.headers["Cache-Control"] = "no-store"
    ALLOWLIST_PATH.parent.mkdir(parents=True, exist_ok=True)
    seen: set[str] = set()
    terms: list[str] = []
    for raw_term in payload.terms:
        term = " ".join(raw_term.split())
        key = term.lower().replace("ё", "е")
        if not term or key in seen:
            continue
        seen.add(key)
        terms.append(term)
    ALLOWLIST_PATH.write_text(
        json.dumps({"terms": terms}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return {"terms": terms}
