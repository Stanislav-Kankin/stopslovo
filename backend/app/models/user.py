from datetime import datetime
from uuid import uuid4

from sqlmodel import Field, SQLModel


class User(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    email: str = Field(unique=True, index=True)
    hashed_password: str | None = None
    oauth_provider: str | None = None
    oauth_id: str | None = None
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
