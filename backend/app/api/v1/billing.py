import json
import os
from datetime import datetime, timedelta
from typing import Annotated
from uuid import uuid4

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.api.v1.auth import get_current_user
from app.db import get_session
from app.models.user import PaymentRecord, User
from app.services.email_service import send_plan_activated_email
from app.services.billing import get_plan_for_payment, public_plan_catalog
from app.services.quota import apply_early_renewal


router = APIRouter(prefix="/api/billing", tags=["billing"])


class CheckoutRequest(BaseModel):
    plan: str = Field(..., pattern="^(freelancer|agency_s|agency_m|one_time)$")


def _yookassa_credentials() -> tuple[str, str]:
    shop_id = os.getenv("YOOKASSA_SHOP_ID", "").strip()
    secret_key = os.getenv("YOOKASSA_SECRET_KEY", "").strip()
    if not shop_id or not secret_key:
        raise HTTPException(
            status_code=501,
            detail="ЮKassa пока не настроена: добавьте YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY.",
        )
    return shop_id, secret_key


def _fetch_yookassa_payment(external_payment_id: str) -> dict:
    shop_id, secret_key = _yookassa_credentials()
    try:
        response = httpx.get(
            f"https://api.yookassa.ru/v3/payments/{external_payment_id}",
            auth=(shop_id, secret_key),
            timeout=20,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"ЮKassa вернула ошибку: {exc.response.text}") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Не удалось проверить платёж в ЮKassa.") from exc
    return response.json()


def _activate_paid_plan(
    session: Session,
    user: User,
    payment: PaymentRecord,
    provider_payload: dict,
    background_tasks: BackgroundTasks | None = None,
) -> User:
    plan = get_plan_for_payment(payment.plan)
    now = datetime.utcnow()
    current_expires_at = user.plan_expires_at
    new_expires_at = now + timedelta(days=plan["duration_days"])

    if (
        user.plan == payment.plan
        and current_expires_at
        and current_expires_at > now
        and new_expires_at > current_expires_at
    ):
        apply_early_renewal(
            session=session,
            user_id=user.id,
            plan=user.plan,
            old_expires_at=current_expires_at,
            new_expires_at=new_expires_at,
            started_at=user.created_at,
        )

    user.plan = payment.plan
    user.plan_expires_at = new_expires_at
    user.payment_provider = "yookassa"
    user.last_payment_id = payment.id
    user.updated_at = now

    payment.status = provider_payload.get("status", "succeeded")
    payment.raw_json = json.dumps(provider_payload, ensure_ascii=False)
    payment.updated_at = now

    session.add(user)
    session.add(payment)
    session.commit()
    session.refresh(user)

    if background_tasks:
        background_tasks.add_task(send_plan_activated_email, user.email, user.plan, user.plan_expires_at)
    else:
        send_plan_activated_email(user.email, user.plan, user.plan_expires_at)

    return user


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
    shop_id = os.getenv("YOOKASSA_SHOP_ID", "").strip()
    secret_key = os.getenv("YOOKASSA_SECRET_KEY", "").strip()
    return_url_base = os.getenv("YOOKASSA_RETURN_URL") or os.getenv("FRONTEND_URL", "").rstrip("/") + "/pricing"

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
        _yookassa_credentials()

    separator = "&" if "?" in return_url_base else "?"
    return_url = f"{return_url_base}{separator}payment_id={payment.id}"

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


@router.post("/yookassa/webhook")
async def yookassa_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    payload = await request.json()
    event = str(payload.get("event", ""))
    payment_object = payload.get("object") or {}
    external_payment_id = payment_object.get("id")
    if not external_payment_id:
        raise HTTPException(status_code=400, detail="В уведомлении нет id платежа.")

    payment = session.exec(
        select(PaymentRecord).where(PaymentRecord.external_payment_id == external_payment_id)
    ).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Платёж не найден.")

    provider_payment = _fetch_yookassa_payment(external_payment_id)
    status = provider_payment.get("status", payment_object.get("status", "unknown"))

    payment.status = status
    payment.raw_json = json.dumps(provider_payment, ensure_ascii=False)
    payment.updated_at = datetime.utcnow()
    session.add(payment)
    session.commit()

    if event == "payment.succeeded" and status == "succeeded":
        user = session.get(User, payment.user_id)
        if not user:
            raise HTTPException(status_code=404, detail="Пользователь платежа не найден.")
        if user.last_payment_id != payment.id:
            _activate_paid_plan(session, user, payment, provider_payment, background_tasks)

    return {"ok": True}


@router.post("/payments/{payment_id}/sync")
def sync_payment_status(
    payment_id: str,
    background_tasks: BackgroundTasks,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    payment = session.get(PaymentRecord, payment_id)
    if not payment or payment.user_id != user.id:
        raise HTTPException(status_code=404, detail="Платеж не найден")
    if not payment.external_payment_id:
        raise HTTPException(status_code=400, detail="У платежа нет id ЮKassa.")

    provider_payment = _fetch_yookassa_payment(payment.external_payment_id)
    status = provider_payment.get("status", "unknown")
    payment.status = status
    payment.raw_json = json.dumps(provider_payment, ensure_ascii=False)
    payment.updated_at = datetime.utcnow()
    session.add(payment)
    session.commit()

    if status == "succeeded" and user.last_payment_id != payment.id:
        user = _activate_paid_plan(session, user, payment, provider_payment, background_tasks)

    return {
        "id": payment.id,
        "plan": payment.plan,
        "status": payment.status,
        "plan_expires_at": user.plan_expires_at,
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
