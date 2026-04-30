RISK_ORDER = ["safe", "low", "medium", "high"]
ESCALATE = {"реклама", "баннер", "упаковка"}
DEESCALATE = {"b2b_документ", "презентация"}


def apply_context_modifier(risk: str, context_type: str) -> str:
    idx = RISK_ORDER.index(risk)
    if context_type in ESCALATE:
        idx = min(idx + 1, len(RISK_ORDER) - 1)
    elif context_type in DEESCALATE:
        idx = max(idx - 1, 0)
    return RISK_ORDER[idx]


class RiskScorer:
    def score(self, issues: list[dict]) -> str:
        if not issues:
            return "safe"
        return max((issue["risk"] for issue in issues), key=RISK_ORDER.index)

    def needs_manual_review(self, context_type: str, issues: list[dict]) -> tuple[bool, str | None]:
        has_high = any(issue["risk"] == "high" for issue in issues)
        ambiguous = [issue["term"] for issue in issues if "бренд" in issue.get("reason", "").lower()]
        if context_type in {"реклама", "баннер"} and has_high:
            return True, "В тексте найден высокий риск, нужна ручная юридическая проверка."
        if ambiguous:
            return True, f"Нужно проверить статус слов как бренда или общеупотребимого термина: {', '.join(ambiguous)}."
        return False, None
