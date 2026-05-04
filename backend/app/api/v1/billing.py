import os
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.api.v1.auth import get_current_user
from app.db import get_session
from app.models.user import PaymentRecord, User
from app.services.billing import get_plan_for_payment, public_plan_catalog


router = APIRouter(prefix="/api/billing", tags=["billing"])


class CheckoutRequest(BaseModel):
    plan: str = Field(..., pattern="^(freelancer|agency_s|agency_m|one_time)$")


@router.get("/plans")
def plans() -> dict:
    return {"items": public_plan_catalog()}


@router.post("/checkout")
def create_checkout(
    payload: CheckoutRequest,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    plan = get_plan_for_payment(payload.plan)
    shop_id = os.getenv("YOOKASSA_SHOP_ID")
    secret_key = os.getenv("YOOKASSA_SECRET_KEY")
    return_url = os.getenv("YOOKASSA_RETURN_URL") or os.getenv("FRONTEND_URL", "").rstrip("/") + "/pricing"

    payment = PaymentRecord(
        user_id=user.id,
        provider="yookassa",
        plan=plan["id"],
        amount_kopecks=plan["amount_kopecks"],
        currency="RUB",
        status="provider_not_configured" if not shop_id or not secret_key else "pending",
    )
    session.add(payment)
    session.commit()
    session.refresh(payment)

    if not shop_id or not secret_key:
        raise HTTPException(
            status_code=501,
            detail="ЮKassa пока не настроена: добавьте YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY.",
        )

    raise HTTPException(
        status_code=501,
        detail=(
            "Каркас оплаты готов, но реальный вызов ЮKassa еще не подключен. "
            f"Платеж {payment.id} создан для будущей интеграции, return_url: {return_url}."
        ),
    )


@router.get("/payments/{payment_id}")
def payment_status(
    payment_id: str,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    payment = session.get(PaymentRecord, payment_id)
    if not payment or payment.user_id != user.id:
        raise HTTPException(status_code=404, detail="Платеж не найден")
    return {
        "id": payment.id,
        "plan": payment.plan,
        "amount_kopecks": payment.amount_kopecks,
        "currency": payment.currency,
        "status": payment.status,
        "confirmation_url": payment.confirmation_url,
        "created_at": payment.created_at,
        "updated_at": payment.updated_at,
    }
