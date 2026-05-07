import os
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Annotated

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field
from sqlmodel import Session, select

from app.db import get_session
from app.models.user import User
from app.services.email_service import send_welcome_email
from app.services.quota import active_plan, get_remaining, next_monthly_renewal


router = APIRouter(prefix="/api/auth", tags=["auth"])
pwd_context = CryptContext(schemes=["pbkdf2_sha256", "bcrypt"], deprecated="auto")

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"
TOKEN_DAYS = 30
COOKIE_NAME = "stopslovo_token"
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://127.0.0.1:5173")
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@admin.ru").lower()
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD")
SECURE_COOKIES = os.getenv("SECURE_COOKIES", "false").lower() == "true"
AUTH_RATE_LIMIT_ATTEMPTS = int(os.getenv("AUTH_RATE_LIMIT_ATTEMPTS", "5"))
AUTH_RATE_LIMIT_WINDOW = int(os.getenv("AUTH_RATE_LIMIT_WINDOW_SECONDS", "60"))
AUTH_ATTEMPTS: dict[str, deque[float]] = defaultdict(deque)


class AuthRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=128)


class AuthResponse(BaseModel):
    ok: bool
    user: dict


class UpdateEmailRequest(BaseModel):
    email: EmailStr


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, hashed_password: str | None) -> bool:
    return bool(hashed_password) and pwd_context.verify(password, hashed_password)


def create_token(user_id: str) -> str:
    expires = datetime.now(timezone.utc) + timedelta(days=TOKEN_DAYS)
    return jwt.encode({"sub": user_id, "exp": expires}, JWT_SECRET, algorithm=JWT_ALGORITHM)


def set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=TOKEN_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=SECURE_COOKIES,
        samesite="lax",
    )


def clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, secure=SECURE_COOKIES, samesite="lax")


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",", 1)[0].strip()
    return request.client.host if request.client else "unknown"


def check_auth_rate_limit(request: Request, action: str) -> None:
    now = time.monotonic()
    key = f"{action}:{_client_ip(request)}"
    attempts = AUTH_ATTEMPTS[key]
    while attempts and now - attempts[0] > AUTH_RATE_LIMIT_WINDOW:
        attempts.popleft()
    if len(attempts) >= AUTH_RATE_LIMIT_ATTEMPTS:
        raise HTTPException(status_code=429, detail="Слишком много попыток. Попробуйте позже.")
    attempts.append(now)


def get_user_from_request(request: Request, session: Session) -> User | None:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
    except JWTError:
        return None
    if not user_id:
        return None
    user = session.get(User, user_id)
    return user if user and user.is_active else None


def get_current_user(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> User:
    user = get_user_from_request(request, session)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return user


def user_payload(user: User, session: Session) -> dict:
    plan = active_plan(user)
    quota = get_remaining(session, user.id, plan, started_at=user.created_at)
    quota_resets_at = next_monthly_renewal(user.created_at) if plan == "free" else None
    return {
        "id": user.id,
        "email": user.email,
        "plan": plan,
        "plan_expires_at": user.plan_expires_at,
        "quota_resets_at": quota_resets_at,
        "is_active": user.is_active,
        "is_admin": user.email.lower() == ADMIN_EMAIL,
        "created_at": user.created_at,
        "updated_at": user.updated_at,
        "oauth_provider": user.oauth_provider,
        "oauth_email_placeholder": user.oauth_email_placeholder,
        "payment_provider": user.payment_provider,
        "payment_customer_id": user.payment_customer_id,
        "payment_subscription_id": user.payment_subscription_id,
        "last_payment_id": user.last_payment_id,
        **quota,
    }


def frontend_redirect(path: str = "/") -> RedirectResponse:
    return RedirectResponse(f"{FRONTEND_URL}{path}")


@router.post("/register", response_model=AuthResponse)
def register(
    payload: AuthRequest,
    request: Request,
    response: Response,
    background_tasks: BackgroundTasks,
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    check_auth_rate_limit(request, "register")
    existing = session.exec(select(User).where(User.email == payload.email.lower())).first()
    if existing:
        raise HTTPException(status_code=409, detail="Пользователь с такой почтой уже существует")
    user = User(email=payload.email.lower(), hashed_password=hash_password(payload.password))
    session.add(user)
    session.commit()
    session.refresh(user)
    set_auth_cookie(response, create_token(user.id))
    background_tasks.add_task(send_welcome_email, user.email)
    return {"ok": True, "user": user_payload(user, session)}


@router.post("/login", response_model=AuthResponse)
def login(payload: AuthRequest, request: Request, response: Response, session: Annotated[Session, Depends(get_session)]) -> dict:
    check_auth_rate_limit(request, "login")
    user = session.exec(select(User).where(User.email == payload.email.lower())).first()
    if not user and ADMIN_PASSWORD and payload.email.lower() == ADMIN_EMAIL and payload.password == ADMIN_PASSWORD:
        user = User(email=ADMIN_EMAIL, hashed_password=hash_password(payload.password), plan="agency_m")
        session.add(user)
        session.commit()
        session.refresh(user)
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Неверная почта или пароль")
    user.updated_at = datetime.utcnow()
    session.add(user)
    session.commit()
    session.refresh(user)
    set_auth_cookie(response, create_token(user.id))
    return {"ok": True, "user": user_payload(user, session)}


@router.post("/refresh", response_model=AuthResponse)
def refresh(
    request: Request,
    response: Response,
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    user = get_current_user(request, session)
    set_auth_cookie(response, create_token(user.id))
    return {"ok": True, "user": user_payload(user, session)}


@router.post("/logout")
def logout(response: Response) -> dict:
    clear_auth_cookie(response)
    return {"ok": True}


@router.get("/me")
def me(request: Request, session: Annotated[Session, Depends(get_session)]) -> dict:
    user = get_user_from_request(request, session)
    if not user:
        return {"authenticated": False, "plan": "anon"}
    return {"authenticated": True, "user": user_payload(user, session)}


@router.post("/email", response_model=AuthResponse)
def update_email(payload: UpdateEmailRequest, request: Request, session: Annotated[Session, Depends(get_session)]) -> dict:
    user = get_current_user(request, session)
    new_email = payload.email.lower()
    existing = session.exec(select(User).where(User.email == new_email, User.id != user.id)).first()
    if existing:
        raise HTTPException(status_code=409, detail="Пользователь с такой почтой уже существует")
    user.email = new_email
    user.oauth_email_placeholder = False
    user.updated_at = datetime.utcnow()
    session.add(user)
    session.commit()
    session.refresh(user)
    return {"ok": True, "user": user_payload(user, session)}


def get_or_create_oauth_user(session: Session, provider: str, oauth_id: str, email: str, email_placeholder: bool = False) -> tuple[User, bool]:
    user = session.exec(
        select(User).where(User.oauth_provider == provider, User.oauth_id == oauth_id)
    ).first()
    if user:
        return user, False
    existing = session.exec(select(User).where(User.email == email.lower())).first()
    if existing:
        existing.oauth_provider = provider
        existing.oauth_id = oauth_id
        existing.oauth_email_placeholder = email_placeholder
        session.add(existing)
        session.commit()
        session.refresh(existing)
        return existing, False
    user = User(email=email.lower(), oauth_provider=provider, oauth_id=oauth_id, oauth_email_placeholder=email_placeholder)
    session.add(user)
    session.commit()
    session.refresh(user)
    return user, True


@router.get("/yandex")
def yandex_login() -> RedirectResponse:
    client_id = os.getenv("YANDEX_CLIENT_ID")
    if not client_id:
        raise HTTPException(status_code=501, detail="Yandex OAuth не настроен")
    redirect_uri = f"{os.getenv('BACKEND_URL', '').rstrip('/')}/api/auth/yandex/callback"
    url = (
        "https://oauth.yandex.ru/authorize"
        f"?response_type=code&client_id={client_id}&redirect_uri={redirect_uri}"
    )
    return RedirectResponse(url)


@router.get("/yandex/callback")
async def yandex_callback(
    code: str,
    response: Response,
    background_tasks: BackgroundTasks,
    session: Annotated[Session, Depends(get_session)],
):
    client_id = os.getenv("YANDEX_CLIENT_ID")
    client_secret = os.getenv("YANDEX_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise HTTPException(status_code=501, detail="Yandex OAuth не настроен")
    async with httpx.AsyncClient(timeout=10) as client:
        token = await client.post(
            "https://oauth.yandex.ru/token",
            data={"grant_type": "authorization_code", "code": code, "client_id": client_id, "client_secret": client_secret},
        )
        token.raise_for_status()
        access_token = token.json()["access_token"]
        info = await client.get("https://login.yandex.ru/info?format=json", headers={"Authorization": f"OAuth {access_token}"})
        info.raise_for_status()
        profile = info.json()
    email = profile.get("default_email") or profile.get("emails", [None])[0]
    if not email:
        raise HTTPException(status_code=400, detail="Yandex не вернул email")
    user, created = get_or_create_oauth_user(session, "yandex", str(profile["id"]), email)
    if created:
        background_tasks.add_task(send_welcome_email, user.email)
    redirect = frontend_redirect("/")
    set_auth_cookie(redirect, create_token(user.id))
    return redirect


@router.get("/vk")
def vk_login() -> RedirectResponse:
    client_id = os.getenv("VK_CLIENT_ID")
    if not client_id:
        raise HTTPException(status_code=501, detail="VK OAuth не настроен")
    redirect_uri = f"{os.getenv('BACKEND_URL', '').rstrip('/')}/api/auth/vk/callback"
    url = (
        "https://oauth.vk.com/authorize"
        f"?client_id={client_id}&display=page&redirect_uri={redirect_uri}&scope=email&response_type=code&v=5.199"
    )
    return RedirectResponse(url)


@router.get("/vk/callback")
async def vk_callback(
    code: str,
    response: Response,
    background_tasks: BackgroundTasks,
    session: Annotated[Session, Depends(get_session)],
):
    client_id = os.getenv("VK_CLIENT_ID")
    client_secret = os.getenv("VK_CLIENT_SECRET")
    redirect_uri = f"{os.getenv('BACKEND_URL', '').rstrip('/')}/api/auth/vk/callback"
    if not client_id or not client_secret:
        raise HTTPException(status_code=501, detail="VK OAuth не настроен")
    async with httpx.AsyncClient(timeout=10) as client:
        token = await client.get(
            "https://oauth.vk.com/access_token",
            params={"client_id": client_id, "client_secret": client_secret, "redirect_uri": redirect_uri, "code": code},
        )
        token.raise_for_status()
        payload = token.json()
    email_placeholder = not bool(payload.get("email"))
    email = payload.get("email") or f"vk-{payload['user_id']}@oauth.local"
    user, created = get_or_create_oauth_user(session, "vk", str(payload["user_id"]), email, email_placeholder=email_placeholder)
    if created and not email_placeholder:
        background_tasks.add_task(send_welcome_email, user.email)
    redirect = frontend_redirect("/")
    set_auth_cookie(redirect, create_token(user.id))
    return redirect
