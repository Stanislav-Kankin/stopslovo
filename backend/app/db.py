from pathlib import Path

from sqlalchemy import inspect, text
from sqlmodel import Session, SQLModel, create_engine


DATA_DIR = Path(__file__).resolve().parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_URL = f"sqlite:///{DATA_DIR / 'users.db'}"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    ensure_user_columns()
    ensure_usage_columns()


def ensure_user_columns() -> None:
    columns = {
        column["name"]
        for column in inspect(engine).get_columns("user")
    }
    migrations = {
        "payment_provider": "ALTER TABLE user ADD COLUMN payment_provider VARCHAR",
        "payment_customer_id": "ALTER TABLE user ADD COLUMN payment_customer_id VARCHAR",
        "payment_subscription_id": "ALTER TABLE user ADD COLUMN payment_subscription_id VARCHAR",
        "last_payment_id": "ALTER TABLE user ADD COLUMN last_payment_id VARCHAR",
        "updated_at": "ALTER TABLE user ADD COLUMN updated_at DATETIME",
    }
    with engine.begin() as connection:
        for name, statement in migrations.items():
            if name not in columns:
                connection.execute(text(statement))


def ensure_usage_columns() -> None:
    columns = {
        column["name"]
        for column in inspect(engine).get_columns("usagerecord")
    }
    migrations = {
        "ai_used": "ALTER TABLE usagerecord ADD COLUMN ai_used INTEGER DEFAULT 0",
        "chars_rollover": "ALTER TABLE usagerecord ADD COLUMN chars_rollover INTEGER DEFAULT 0",
        "rows_rollover": "ALTER TABLE usagerecord ADD COLUMN rows_rollover INTEGER DEFAULT 0",
        "ai_rollover": "ALTER TABLE usagerecord ADD COLUMN ai_rollover INTEGER DEFAULT 0",
        "rollover_expires_at": "ALTER TABLE usagerecord ADD COLUMN rollover_expires_at DATETIME",
    }
    with engine.begin() as connection:
        for name, statement in migrations.items():
            if name not in columns:
                connection.execute(text(statement))


def get_session():
    with Session(engine) as session:
        yield session
