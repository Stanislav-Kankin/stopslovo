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


def get_plan_for_payment(plan: str) -> dict:
    if plan not in PLAN_CATALOG:
        raise ValueError("Unknown paid plan")
    return {"id": plan, **PLAN_CATALOG[plan]}


def public_plan_catalog() -> list[dict]:
    return [
        {
            "id": plan,
            "name": item["name"],
            "amount_kopecks": item["amount_kopecks"],
            "duration_days": item["duration_days"],
        }
        for plan, item in PLAN_CATALOG.items()
    ]
