import math
from datetime import datetime

from sqlmodel import Session, select

from app.models.user import SubscriptionReminder, User
from app.services.email_service import send_subscription_reminder_email
from app.services.quota import active_plan


PAID_PLANS = {"freelancer", "agency_s", "agency_m", "one_time"}
REMINDER_THRESHOLDS_DAYS = {7, 3, 1}


def send_due_subscription_reminders(session: Session, now: datetime | None = None) -> dict:
    now = now or datetime.utcnow()
    users = session.exec(
        select(User).where(
            User.is_active == True,  # noqa: E712
            User.plan.in_(PAID_PLANS),
            User.plan_expires_at.is_not(None),
            User.plan_expires_at > now,
        )
    ).all()

    checked = 0
    sent = 0
    skipped = 0

    for user in users:
        if not user.plan_expires_at:
            continue
        if active_plan(user) == "free":
            continue

        seconds_left = (user.plan_expires_at - now).total_seconds()
        days_left = math.ceil(seconds_left / 86400)
        checked += 1

        if days_left not in REMINDER_THRESHOLDS_DAYS:
            skipped += 1
            continue

        already_sent = session.exec(
            select(SubscriptionReminder).where(
                SubscriptionReminder.user_id == user.id,
                SubscriptionReminder.plan_expires_at == user.plan_expires_at,
                SubscriptionReminder.threshold_days == days_left,
            )
        ).first()
        if already_sent:
            skipped += 1
            continue

        if send_subscription_reminder_email(user.email, user.plan, user.plan_expires_at, days_left):
            session.add(
                SubscriptionReminder(
                    user_id=user.id,
                    plan=user.plan,
                    plan_expires_at=user.plan_expires_at,
                    threshold_days=days_left,
                    sent_at=now,
                )
            )
            session.commit()
            sent += 1
        else:
            skipped += 1

    return {"checked": checked, "sent": sent, "skipped": skipped}
