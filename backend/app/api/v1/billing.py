import json
import os
from typing import Annotated
from uuid import uuid4

import httpx
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

    request_body = {
        "amount": {
            "value": f"{plan['amount_kopecks'] / 100:.2f}",
            "currency": "RUB",
        },
        "capture": True,
        "confirmation": {
            "type": "redirect",
            "return_url": return_url,
        },
        "description": f"СтопСлово: {plan['name']}",
        "metadata": {
            "payment_id": payment.id,
            "user_id": user.id,
            "plan": plan["id"],
        },
    }
    try:
        provider_response = httpx.post(
            "https://api.yookassa.ru/v3/payments",
            auth=(shop_id, secret_key),
            headers={"Idempotence-Key": payment.id or str(uuid4())},
            json=request_body,
            timeout=20,
        )
        provider_response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        payment.status = "provider_error"
        payment.raw_json = exc.response.text
        session.add(payment)
        session.commit()
        raise HTTPException(status_code=502, detail=f"ЮKassa вернула ошибку: {exc.response.text}") from exc
    except httpx.HTTPError as exc:
        payment.status = "provider_error"
        payment.raw_json = str(exc)
        session.add(payment)
        session.commit()
        raise HTTPException(status_code=502, detail="Не удалось создать платёж в ЮKassa. Попробуйте позже.") from exc

    data = provider_response.json()
    payment.external_payment_id = data.get("id")
    payment.status = data.get("status", "pending")
    payment.confirmation_url = (data.get("confirmation") or {}).get("confirmation_url")
    payment.raw_json = json.dumps(data, ensure_ascii=False)
    session.add(payment)
    session.commit()
    session.refresh(payment)

    if not payment.confirmation_url:
        raise HTTPException(status_code=502, detail="ЮKassa не вернула ссылку на оплату.")

    return {
        "id": payment.id,
        "plan": payment.plan,
        "amount_kopecks": payment.amount_kopecks,
        "currency": payment.currency,
        "status": payment.status,
        "confirmation_url": payment.confirmation_url,
    }


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
