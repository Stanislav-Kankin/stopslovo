import json
import logging
import os
import re
from typing import Any

from anthropic import Anthropic
from openai import OpenAI

from app.services.risk_scorer import RiskScorer

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = """You are a compliance analysis engine for Russian advertising law (Federal Law No. 149-FZ).

The core legal principle: if a foreign word or Cyrillic borrowing has a commonly used
Russian equivalent, it must be replaced in advertising and consumer-facing content.

## INPUT

You receive a JSON object:
{
  "text": "<original text>",
  "context_type": "<реклама|карточка_товара|баннер|упаковка|сайт|презентация|b2b_документ>",
  "flagged_by_dictionary": [
    {
      "term": "<word as found in text>",
      "normalized": "<base form>",
      "script": "latin|cyrillic_borrowing",
      "risk_base": "high|medium|low|safe",
      "known_replacements": ["<option1>", "<option2>"]
    }
  ]
}

## YOUR TASKS

1. Review each flagged term in context - confirm or downgrade the risk
2. Find any additional terms the dictionary may have missed
3. Assess final risk for each term (after context has already been applied by backend)
4. Improve or confirm replacement suggestions - they must be natural Russian
5. Rewrite the full text replacing HIGH and MEDIUM risk terms
6. Return structured JSON, then delimiter, then Russian summary

## RISK LEVELS

HIGH: foreign/borrowed word, natural Russian equivalent exists, consumer-facing
MEDIUM: borderline - partially assimilated OR replacement sounds slightly unnatural
LOW: no good Russian equivalent, or highly technical term with no standard alternative
SAFE: fully assimilated word, proper noun, brand name, trademark

## REPLACEMENT RULES

Good replacements:
- Actually used in real Russian speech (not invented or bureaucratic)
- Match the register of the original text (casual stays casual, formal stays formal)
- Short and specific

Bad: "мероприятие по установлению деловых контактов" for "нетворкинг"
Good: "деловые знакомства", "отраслевое общение"

Bad: "распродажа товаров по сниженным ценам" for "sale"
Good: "распродажа", "скидки"

If no natural replacement exists: replacements: [], keep_as_is: true, risk: "low"

Never flag: brand names, product names, trademarks, fully assimilated words
(телефон, компьютер, интернет, такси, кофе, банк, офис)

## OUTPUT FORMAT

Respond ONLY with valid JSON, then the delimiter ---SUMMARY---, then a Russian summary.
No markdown, no explanation outside this structure.

{
  "overall_risk": "high|medium|low|safe",
  "issues": [
    {
      "term": "<as appears in text>",
      "normalized": "<base form>",
      "category": "latin|cyrillic_borrowing|missed_by_dictionary",
      "risk": "high|medium|low|safe",
      "reason": "<1-2 sentences referencing law logic>",
      "replacements": ["<option1>", "<option2>"],
      "keep_as_is": true|false
    }
  ],
  "rewritten_text": "<full text with HIGH and MEDIUM terms replaced>",
  "manual_review_required": true|false,
  "manual_review_reason": "<if true: what specifically needs human review>"
}

---SUMMARY---

<3-5 sentences in Russian for a non-technical user:
- how many issues found and overall risk level
- which terms are most critical
- whether manual review is needed
- closing disclaimer: это автоматическая оценка риска, не юридическое заключение>

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
        self.provider = os.getenv("LLM_PROVIDER") or ("anthropic" if os.getenv("ANTHROPIC_API_KEY") else "deepseek")
        self.deepseek_api_key = os.getenv("DEEPSEEK_API_KEY")
        self.deepseek_model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
        self.deepseek_base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
        self.anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")
        self.anthropic_model = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")
        self.max_text_chars = int(os.getenv("LLM_MAX_TEXT_CHARS", "4000"))
        self.max_flagged_terms = int(os.getenv("LLM_MAX_FLAGGED_TERMS", "20"))
        self.scorer = RiskScorer()

    def analyze(self, text: str, context_type: str, flagged: list[dict], use_llm: bool = True) -> dict[str, Any]:
        skip_reason = self._llm_skip_reason(text, flagged, use_llm)
        if skip_reason:
            return self._fallback(text, context_type, flagged, skip_reason=skip_reason)
        if use_llm and self._has_provider_key():
            try:
                if self.provider == "anthropic":
                    return self._analyze_with_anthropic(text, context_type, flagged)
                return self._analyze_with_deepseek(text, context_type, flagged)
            except Exception as exc:
                logger.exception("%s analysis failed: %s", self.provider, exc)
                return self._fallback(text, context_type, flagged, llm_failed=True)
        return self._fallback(text, context_type, flagged)

    def _llm_skip_reason(self, text: str, flagged: list[dict], use_llm: bool) -> str | None:
        if not use_llm:
            return "LLM отключен для этого запроса."
        if not flagged:
            return "Нет спорных терминов для LLM-разбора."
        if len(text) > self.max_text_chars:
            return f"Текст длиннее лимита LLM ({len(text)} > {self.max_text_chars} символов)."
        if len(flagged) > self.max_flagged_terms:
            return f"Слишком много спорных терминов для одного LLM-запроса ({len(flagged)} > {self.max_flagged_terms})."
        return None

    def _has_provider_key(self) -> bool:
        if self.provider == "anthropic":
            return bool(self.anthropic_api_key)
        return bool(self.deepseek_api_key)

    def _payload(self, text: str, context_type: str, flagged: list[dict]) -> dict[str, Any]:
        return {
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

    def _analyze_with_deepseek(self, text: str, context_type: str, flagged: list[dict]) -> dict[str, Any]:
        client = OpenAI(api_key=self.deepseek_api_key, base_url=self.deepseek_base_url)
        payload = self._payload(text, context_type, flagged)
        completion = client.chat.completions.create(
            model=self.deepseek_model,
            temperature=0,
            max_tokens=2500,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ],
        )
        content = completion.choices[0].message.content or ""
        return self._parse_response(content)

    def _analyze_with_anthropic(self, text: str, context_type: str, flagged: list[dict]) -> dict[str, Any]:
        client = Anthropic(api_key=self.anthropic_api_key)
        payload = self._payload(text, context_type, flagged)
        message = client.messages.create(
            model=self.anthropic_model,
            max_tokens=2500,
            temperature=0,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
        )
        content = "".join(block.text for block in message.content if getattr(block, "type", "") == "text")
        return self._parse_response(content)

    def _parse_response(self, content: str) -> dict[str, Any]:
        if "---SUMMARY---" not in content:
            raise ValueError("DeepSeek response is missing summary delimiter")
        json_part, summary = content.split("---SUMMARY---", 1)
        data = json.loads(json_part.strip())
        data["summary"] = self._ensure_disclaimer(summary.strip())
        return data

    def _fallback(
        self,
        text: str,
        context_type: str,
        flagged: list[dict],
        llm_failed: bool = False,
        skip_reason: str | None = None,
    ) -> dict[str, Any]:
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
        summary = self._summary(issues, overall, manual, llm_failed, skip_reason)
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

    def _summary(self, issues: list[dict], overall: str, manual: bool, llm_failed: bool, skip_reason: str | None) -> str:
        if not issues:
            base = "Проблемных слов не найдено, общий риск: safe."
        else:
            critical = ", ".join(issue["term"] for issue in issues if issue["risk"] in {"high", "medium"})
            base = f"Найдено замечаний: {len(issues)}, общий риск: {overall}. Наиболее важные слова: {critical or 'нет'}."
        review = "Ручная проверка требуется." if manual else "Ручная проверка не требуется по автоматическим правилам."
        fail_note = f" LLM-анализ {self.provider} недоступен, использована локальная проверка." if llm_failed else ""
        skip_note = f" LLM не запускался: {skip_reason}" if skip_reason and issues else ""
        return self._ensure_disclaimer(f"{base} {review}{fail_note}{skip_note}")

    @staticmethod
    def _ensure_disclaimer(summary: str) -> str:
        disclaimer = "Это автоматическая оценка риска, не юридическое заключение."
        return summary if disclaimer in summary else f"{summary} {disclaimer}"
