import os

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.admin import router as admin_router
from app.api.v1.auth import router as auth_router
from app.api.v1.billing import router as billing_router
from app.api.v1.check import router as check_router
from app.db import init_db
from app.models import CheckResult, PaymentRecord, SharedReport, UsageRecord, User

sentry_dsn = os.getenv("SENTRY_DSN")
if sentry_dsn:
    import sentry_sdk

    sentry_sdk.init(
        dsn=sentry_dsn,
        environment=os.getenv("APP_ENV", "production"),
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.0")),
    )

app = FastAPI(
    title="СтопСлово",
    version="2.0.0",
    description="Сервис автоматической оценки рекламных текстов на иностранные слова и англицизмы.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
        if origin.strip()
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()

app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(billing_router)
app.include_router(check_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
