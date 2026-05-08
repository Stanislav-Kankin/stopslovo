from datetime import datetime
from uuid import uuid4

from sqlmodel import Field, SQLModel


class User(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    email: str = Field(unique=True, index=True)
    hashed_password: str | None = None
    oauth_provider: str | None = None
    oauth_id: str | None = None
    oauth_email_placeholder: bool = False
    plan: str = "free"
    plan_expires_at: datetime | None = None
    payment_provider: str | None = None
    payment_customer_id: str | None = None
    payment_subscription_id: str | None = None
    last_payment_id: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    is_active: bool = True


class UsageRecord(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: str = Field(foreign_key="user.id", index=True)
    month: str
    chars_used: int = 0
    rows_used: int = 0
    ai_used: int = 0
    chars_rollover: int = 0
    rows_rollover: int = 0
    ai_rollover: int = 0
    rollover_expires_at: datetime | None = None


class CheckResult(SQLModel, table=True):
    id: str = Field(primary_key=True)
    data_json: str
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class SharedReport(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    kind: str
    data_json: str
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class PaymentRecord(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    user_id: str = Field(foreign_key="user.id", index=True)
    provider: str = "yookassa"
    plan: str
    amount_kopecks: int
    currency: str = "RUB"
    status: str = "pending"
    external_payment_id: str | None = Field(default=None, index=True)
    confirmation_url: str | None = None
    raw_json: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class SubscriptionReminder(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: str = Field(foreign_key="user.id", index=True)
    plan: str
    plan_expires_at: datetime = Field(index=True)
    threshold_days: int
    sent_at: datetime = Field(default_factory=datetime.utcnow, index=True)
