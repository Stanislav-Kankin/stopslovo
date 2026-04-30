from datetime import datetime

from sqlmodel import Session, select

from app.models.user import UsageRecord


PLAN_LIMITS = {
    "anon": {"chars_per_month": 1_000, "rows_per_month": 100, "one_time": True},
    "free": {"chars_per_month": 1_800, "rows_per_month": 200, "one_time": False},
    "freelancer": {"chars_per_month": 10_000, "rows_per_month": 5_000, "one_time": False},
    "agency_s": {"chars_per_month": 120_000, "rows_per_month": 50_000, "one_time": False},
    "agency_m": {"chars_per_month": -1, "rows_per_month": -1, "one_time": False},
}


def current_month(plan: str) -> str:
    return "one-time" if PLAN_LIMITS.get(plan, PLAN_LIMITS["free"]).get("one_time") else datetime.utcnow().strftime("%Y-%m")


def get_or_create_usage(session: Session, user_id: str, plan: str) -> UsageRecord:
    month = current_month(plan)
    record = session.exec(
        select(UsageRecord).where(UsageRecord.user_id == user_id, UsageRecord.month == month)
    ).first()
    if record:
        return record
    record = UsageRecord(user_id=user_id, month=month)
    session.add(record)
    session.commit()
    session.refresh(record)
    return record


def check_quota(session: Session, user_id: str, plan: str, chars: int = 0, rows: int = 0) -> bool:
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
    record = get_or_create_usage(session, user_id, plan)

    chars_limit = limits["chars_per_month"]
    rows_limit = limits["rows_per_month"]
    chars_ok = chars_limit < 0 or record.chars_used + chars <= chars_limit
    rows_ok = rows_limit < 0 or record.rows_used + rows <= rows_limit
    if not chars_ok or not rows_ok:
        return False

    record.chars_used += chars
    record.rows_used += rows
    session.add(record)
    session.commit()
    return True


def get_remaining(session: Session, user_id: str, plan: str) -> dict:
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
    record = get_or_create_usage(session, user_id, plan)

    def remaining(limit: int, used: int) -> int:
        return -1 if limit < 0 else max(limit - used, 0)

    return {
        "chars_used": record.chars_used,
        "rows_used": record.rows_used,
        "chars_limit": limits["chars_per_month"],
        "rows_limit": limits["rows_per_month"],
        "chars_remaining": remaining(limits["chars_per_month"], record.chars_used),
        "rows_remaining": remaining(limits["rows_per_month"], record.rows_used),
    }
