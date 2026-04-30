from datetime import datetime, timedelta

from sqlmodel import Session, select

from app.models.user import UsageRecord


PLAN_LIMITS = {
    "anon": {"chars_per_month": 1_000, "rows_per_month": 100, "ai_per_month": 0, "one_time": True},
    "free": {"chars_per_month": 1_800, "rows_per_month": 200, "ai_per_month": 5, "one_time": False},
    "freelancer": {"chars_per_month": 10_000, "rows_per_month": 5_000, "ai_per_month": -1, "one_time": False},
    "agency_s": {"chars_per_month": 120_000, "rows_per_month": 50_000, "ai_per_month": -1, "one_time": False},
    "agency_m": {"chars_per_month": -1, "rows_per_month": -1, "ai_per_month": -1, "one_time": False},
    "one_time": {"chars_per_month": 5_000, "rows_per_month": 2_000, "ai_per_month": -1, "one_time": True},
}


def next_monthly_renewal(started_at: datetime, now: datetime | None = None) -> datetime:
    now = now or datetime.utcnow()
    base = started_at.replace(tzinfo=None)
    year = now.year
    month = now.month

    def candidate_for(candidate_year: int, candidate_month: int) -> datetime:
        if candidate_month == 12:
            next_month = datetime(candidate_year + 1, 1, 1)
        else:
            next_month = datetime(candidate_year, candidate_month + 1, 1)
        last_day = (next_month - timedelta(days=1)).day
        day = min(base.day, last_day)
        return datetime(candidate_year, candidate_month, day, base.hour, base.minute, base.second)

    candidate = candidate_for(year, month)
    if candidate <= now:
        if month == 12:
            year += 1
            month = 1
        else:
            month += 1
        candidate = candidate_for(year, month)
    return candidate


def current_month(plan: str, started_at: datetime | None = None) -> str:
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
    if limits.get("one_time"):
        return "one-time"
    if not started_at:
        return datetime.utcnow().strftime("%Y-%m")
    renewal = next_monthly_renewal(started_at)
    previous_month = renewal.month - 1
    previous_year = renewal.year
    if previous_month == 0:
        previous_month = 12
        previous_year -= 1
    return f"{previous_year:04d}-{previous_month:02d}-{started_at.day:02d}"


def get_or_create_usage(session: Session, user_id: str, plan: str, started_at: datetime | None = None) -> UsageRecord:
    month = current_month(plan, started_at)
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


def check_quota(session: Session, user_id: str, plan: str, chars: int = 0, rows: int = 0, started_at: datetime | None = None) -> bool:
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
    record = get_or_create_usage(session, user_id, plan, started_at)

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


def check_ai_quota(session: Session, user_id: str, plan: str, amount: int = 1, started_at: datetime | None = None) -> bool:
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
    record = get_or_create_usage(session, user_id, plan, started_at)
    ai_limit = limits["ai_per_month"]
    if ai_limit >= 0 and record.ai_used + amount > ai_limit:
        return False
    record.ai_used += amount
    session.add(record)
    session.commit()
    return True


def has_ai_quota(session: Session, user_id: str, plan: str, amount: int = 1, started_at: datetime | None = None) -> bool:
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
    record = get_or_create_usage(session, user_id, plan, started_at)
    ai_limit = limits["ai_per_month"]
    return ai_limit < 0 or record.ai_used + amount <= ai_limit


def get_remaining(session: Session, user_id: str, plan: str, started_at: datetime | None = None) -> dict:
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
    record = get_or_create_usage(session, user_id, plan, started_at)

    def remaining(limit: int, used: int) -> int:
        return -1 if limit < 0 else max(limit - used, 0)

    return {
        "chars_used": record.chars_used,
        "rows_used": record.rows_used,
        "ai_used": record.ai_used,
        "chars_limit": limits["chars_per_month"],
        "rows_limit": limits["rows_per_month"],
        "ai_limit": limits["ai_per_month"],
        "chars_remaining": remaining(limits["chars_per_month"], record.chars_used),
        "rows_remaining": remaining(limits["rows_per_month"], record.rows_used),
        "ai_remaining": remaining(limits["ai_per_month"], record.ai_used),
    }
