import json
import os
import re
from typing import Any

from anthropic import Anthropic

from app.services.risk_scorer import RiskScorer


SYSTEM_PROMPT = """You are a compliance analysis engine for Russian advertising law (Federal Law No. 149-FZ).

The core legal principle: if a foreign word or Cyrillic borrowing has a commonly used
Russian equivalent, it must be replaced in advertising and consumer-facing content.

## INPUT

You receive a JSON object:
{
  "text": "<original text>",
  "context_type": "<реклама|карточка_товара|баннер|упаковка|сайт|презентация|b2b_документ>",
  "flagged_by_dictionary": []
}

## YOUR TASKS

1. Review each flagged term in context — confirm or downgrade the risk
2. Find any additional terms the dictionary may have missed
3. Assess final risk for each term (after context has already been applied by backend)
4. Improve or confirm replacement suggestions — they must be natural Russian
5. Rewrite the full text replacing HIGH and MEDIUM risk terms
6. Return structured JSON, then delimiter, then Russian summary

## HARD CONSTRAINTS

- Never say text "complies with the law" or "is legally safe"
- Never flag proper nouns or brand names
- Never invent replacements that don't exist in real Russian speech
- If text is fully clean: issues: [], overall_risk: "safe", rewritten_text equals original text
- manual_review_required must be true if: context is реклама or баннер AND any HIGH risk found,
  OR any term has ambiguous brand/common-word status
- Output must start with { and JSON must be complete and valid before ---SUMMARY---
"""


class LLMAnalyzer:
    def __init__(self) -> None:
        self.api_key = os.getenv("ANTHROPIC_API_KEY")
        self.model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")
        self.scorer = RiskScorer()

    def analyze(self, text: str, context_type: str, flagged: list[dict]) -> dict[str, Any]:
        if self.api_key:
            try:
                return self._analyze_with_claude(text, context_type, flagged)
            except Exception:
                return self._fallback(text, context_type, flagged, llm_failed=True)
        return self._fallback(text, context_type, flagged)

    def _analyze_with_claude(self, text: str, context_type: str, flagged: list[dict]) -> dict[str, Any]:
        client = Anthropic(api_key=self.api_key)
        payload = {
            "text": text,
            "context_type": context_type,
            "flagged_by_dictionary": [
                {
                    "term": item["term"],
                    "normalized": item["normalized"],
                    "script": item["script"],
                    "risk_base": item["risk"],
                    "known_replacements": item["replacements"],
                }
                for item in flagged
            ],
        }
        message = client.messages.create(
            model=self.model,
            max_tokens=2500,
            temperature=0,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
        )
        content = "".join(block.text for block in message.content if getattr(block, "type", "") == "text")
        return self._parse_response(content)

    def _parse_response(self, content: str) -> dict[str, Any]:
        if "---SUMMARY---" not in content:
            raise ValueError("Claude response is missing summary delimiter")
        json_part, summary = content.split("---SUMMARY---", 1)
        data = json.loads(json_part.strip())
        data["summary"] = self._ensure_disclaimer(summary.strip())
        return data

    def _fallback(self, text: str, context_type: str, flagged: list[dict], llm_failed: bool = False) -> dict[str, Any]:
        issues = [
            {
                "term": item["term"],
                "normalized": item["normalized"],
                "category": item["category"],
                "risk": item["risk"],
                "reason": item["reason"],
                "replacements": item["replacements"],
                "keep_as_is": item["keep_as_is"],
            }
            for item in flagged
            if item["risk"] != "safe"
        ]
        rewritten = self._rewrite(text, issues)
        overall = self.scorer.score(issues)
        manual, reason = self.scorer.needs_manual_review(context_type, issues)
        summary = self._summary(issues, overall, manual, llm_failed)
        return {
            "overall_risk": overall,
            "issues": issues,
            "rewritten_text": rewritten,
            "summary": summary,
            "manual_review_required": manual,
            "manual_review_reason": reason,
        }

    @staticmethod
    def _rewrite(text: str, issues: list[dict]) -> str:
        rewritten = text
        for issue in sorted(issues, key=lambda item: len(item["term"]), reverse=True):
            if issue["risk"] not in {"high", "medium"} or not issue["replacements"]:
                continue
            replacement = issue["replacements"][0]
            rewritten = re.sub(rf"\b{re.escape(issue['term'])}\b", replacement, rewritten, flags=re.IGNORECASE)
        return rewritten

    def _summary(self, issues: list[dict], overall: str, manual: bool, llm_failed: bool) -> str:
        if not issues:
            base = "Проблемных слов не найдено, общий риск: safe."
        else:
            critical = ", ".join(issue["term"] for issue in issues if issue["risk"] in {"high", "medium"})
            base = f"Найдено замечаний: {len(issues)}, общий риск: {overall}. Наиболее важные слова: {critical or 'нет'}."
        review = "Ручная проверка требуется." if manual else "Ручная проверка не требуется по автоматическим правилам."
        fail_note = " LLM-анализ недоступен, использована локальная проверка." if llm_failed else ""
        return self._ensure_disclaimer(f"{base} {review}{fail_note}")

    @staticmethod
    def _ensure_disclaimer(summary: str) -> str:
        disclaimer = "Это автоматическая оценка риска, не юридическое заключение."
        return summary if disclaimer in summary else f"{summary} {disclaimer}"
