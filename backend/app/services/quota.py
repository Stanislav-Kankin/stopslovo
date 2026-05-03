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


def current_month(plan: str, started_at: datetime | None = None, now: datetime | None = None) -> str:
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
    if limits.get("one_time"):
        return "one-time"
    if not started_at:
        return (now or datetime.utcnow()).strftime("%Y-%m")
    renewal = next_monthly_renewal(started_at, now=now)
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


def _rollover_valid(record: UsageRecord, now: datetime | None = None) -> bool:
    now = now or datetime.utcnow()
    expires_at = record.rollover_expires_at
    if isinstance(expires_at, str):
        try:
            expires_at = datetime.fromisoformat(expires_at)
        except ValueError:
            return False
    return bool(expires_at and expires_at > now)


def _effective_rollover(record: UsageRecord, field: str) -> int:
    if not _rollover_valid(record):
        return 0
    return max(int(getattr(record, field, 0) or 0), 0)


def _rollover_expires_iso(record: UsageRecord) -> str | None:
    if not _rollover_valid(record) or not record.rollover_expires_at:
        return None
    if isinstance(record.rollover_expires_at, str):
        return record.rollover_expires_at
    return record.rollover_expires_at.isoformat()


def _can_spend(used: int, amount: int, limit: int, rollover: int) -> bool:
    if limit < 0:
        return True
    return used + amount <= limit + rollover


def _spend_with_rollover(record: UsageRecord, used_field: str, rollover_field: str, amount: int, limit: int) -> None:
    if amount <= 0:
        return
    if limit < 0:
        setattr(record, used_field, int(getattr(record, used_field, 0) or 0) + amount)
        return
    used = int(getattr(record, used_field, 0) or 0)
    main_available = max(limit - used, 0)
    if amount <= main_available:
        setattr(record, used_field, used + amount)
        return
    overflow = amount - main_available
    setattr(record, used_field, limit)
    if _rollover_valid(record):
        rollover = int(getattr(record, rollover_field, 0) or 0)
        setattr(record, rollover_field, max(rollover - overflow, 0))


def check_quota(session: Session, user_id: str, plan: str, chars: int = 0, rows: int = 0, started_at: datetime | None = None) -> bool:
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
    record = get_or_create_usage(session, user_id, plan, started_at)

    chars_limit = limits["chars_per_month"]
    rows_limit = limits["rows_per_month"]
    chars_ok = _can_spend(record.chars_used, chars, chars_limit, _effective_rollover(record, "chars_rollover"))
    rows_ok = _can_spend(record.rows_used, rows, rows_limit, _effective_rollover(record, "rows_rollover"))
    if not chars_ok or not rows_ok:
        return False

    _spend_with_rollover(record, "chars_used", "chars_rollover", chars, chars_limit)
    _spend_with_rollover(record, "rows_used", "rows_rollover", rows, rows_limit)
    session.add(record)
    session.commit()
    return True


def check_ai_quota(session: Session, user_id: str, plan: str, amount: int = 1, started_at: datetime | None = None) -> bool:
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
    record = get_or_create_usage(session, user_id, plan, started_at)
    ai_limit = limits["ai_per_month"]
    if not _can_spend(record.ai_used, amount, ai_limit, _effective_rollover(record, "ai_rollover")):
        return False
    _spend_with_rollover(record, "ai_used", "ai_rollover", amount, ai_limit)
    session.add(record)
    session.commit()
    return True


def has_ai_quota(session: Session, user_id: str, plan: str, amount: int = 1, started_at: datetime | None = None) -> bool:
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
    record = get_or_create_usage(session, user_id, plan, started_at)
    ai_limit = limits["ai_per_month"]
    return _can_spend(record.ai_used, amount, ai_limit, _effective_rollover(record, "ai_rollover"))


def apply_early_renewal(
    session: Session,
    user_id: str,
    plan: str,
    old_expires_at: datetime,
    new_expires_at: datetime,
    started_at: datetime | None,
) -> None:
    if old_expires_at <= datetime.utcnow() or new_expires_at <= old_expires_at:
        return
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
    current_record = get_or_create_usage(session, user_id, plan, started_at)

    def leftover(limit: int, used: int, rollover_field: str) -> int:
        if limit < 0:
            return 0
        return max(limit - used, 0) + _effective_rollover(current_record, rollover_field)

    chars_leftover = leftover(limits["chars_per_month"], current_record.chars_used, "chars_rollover")
    rows_leftover = leftover(limits["rows_per_month"], current_record.rows_used, "rows_rollover")
    ai_leftover = leftover(limits["ai_per_month"], current_record.ai_used, "ai_rollover")
    if chars_leftover == 0 and rows_leftover == 0 and ai_leftover == 0:
        return

    new_month = current_month(plan, started_at, now=old_expires_at + timedelta(seconds=1))
    new_record = session.exec(select(UsageRecord).where(UsageRecord.user_id == user_id, UsageRecord.month == new_month)).first()
    if not new_record:
        new_record = UsageRecord(user_id=user_id, month=new_month)
        session.add(new_record)

    new_record.chars_rollover = chars_leftover
    new_record.rows_rollover = rows_leftover
    new_record.ai_rollover = ai_leftover
    new_record.rollover_expires_at = new_expires_at
    session.add(new_record)
    session.commit()


def get_remaining(session: Session, user_id: str, plan: str, started_at: datetime | None = None) -> dict:
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
    record = get_or_create_usage(session, user_id, plan, started_at)

    def remaining(limit: int, used: int) -> int:
        return -1 if limit < 0 else max(limit - used, 0)

    chars_rollover = _effective_rollover(record, "chars_rollover")
    rows_rollover = _effective_rollover(record, "rows_rollover")
    ai_rollover = _effective_rollover(record, "ai_rollover")

    return {
        "chars_used": record.chars_used,
        "rows_used": record.rows_used,
        "ai_used": record.ai_used,
        "chars_limit": limits["chars_per_month"],
        "rows_limit": limits["rows_per_month"],
        "ai_limit": limits["ai_per_month"],
        "chars_remaining": -1 if limits["chars_per_month"] < 0 else max(limits["chars_per_month"] + chars_rollover - record.chars_used, 0),
        "rows_remaining": -1 if limits["rows_per_month"] < 0 else max(limits["rows_per_month"] + rows_rollover - record.rows_used, 0),
        "ai_remaining": -1 if limits["ai_per_month"] < 0 else max(limits["ai_per_month"] + ai_rollover - record.ai_used, 0),
        "chars_rollover": chars_rollover,
        "rows_rollover": rows_rollover,
        "ai_rollover": ai_rollover,
        "rollover_expires_at": _rollover_expires_iso(record),
    }
