import os


PLAN_CATALOG = {
    "freelancer": {
        "name": "Фрилансер",
        "amount_kopecks": 199_000,
        "duration_days": 30,
    },
    "agency_s": {
        "name": "Команда",
        "amount_kopecks": 599_000,
        "duration_days": 30,
    },
    "agency_m": {
        "name": "Агентство",
        "amount_kopecks": 1_299_000,
        "duration_days": 30,
    },
    "one_time": {
        "name": "Разовая проверка",
        "amount_kopecks": 49_000,
        "duration_days": 7,
    },
}


PLAN_AMOUNT_ENV = {
    "freelancer": "YOOKASSA_FREELANCER_AMOUNT_KOPECKS",
    "agency_s": "YOOKASSA_AGENCY_S_AMOUNT_KOPECKS",
    "agency_m": "YOOKASSA_AGENCY_M_AMOUNT_KOPECKS",
    "one_time": "YOOKASSA_ONE_TIME_AMOUNT_KOPECKS",
}


def _amount_for_plan(plan: str, default_amount: int) -> int:
    env_name = PLAN_AMOUNT_ENV.get(plan)
    if not env_name:
        return default_amount

    raw_value = os.getenv(env_name, "").strip()
    if not raw_value:
        return default_amount

    try:
        amount = int(raw_value)
    except ValueError:
        return default_amount

    return amount if amount > 0 else default_amount


def get_plan_for_payment(plan: str) -> dict:
    if plan not in PLAN_CATALOG:
        raise ValueError("Unknown paid plan")
    item = dict(PLAN_CATALOG[plan])
    item["amount_kopecks"] = _amount_for_plan(plan, item["amount_kopecks"])
    return {"id": plan, **item}


def public_plan_catalog() -> list[dict]:
    return [
        {
            "id": item["id"],
            "name": item["name"],
            "amount_kopecks": item["amount_kopecks"],
            "duration_days": item["duration_days"],
        }
        for item in (get_plan_for_payment(plan) for plan in PLAN_CATALOG)
    ]
