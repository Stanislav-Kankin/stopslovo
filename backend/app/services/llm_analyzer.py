import json
import logging
import os
import re
from typing import Any

from anthropic import Anthropic
from openai import OpenAI

from app.services.risk_scorer import RiskScorer

logger = logging.getLogger(__name__)

RISK_LABELS = {
    "high": "высокий",
    "medium": "средний",
    "low": "низкий",
    "safe": "без замечаний",
}


SYSTEM_PROMPT = """You are a compliance analysis engine for Russian advertising law (Federal Law No. 149-FZ).

The core legal principle: if a foreign word or Cyrillic borrowing has a commonly used
Russian equivalent, it must be replaced in advertising and consumer-facing content.

## INPUT

You receive a JSON object:
{
  "text": "<original text>",
  "context_type": "<реклама|карточка_товара|баннер|упаковка|сайт|презентация|b2b_документ>",
  "analysis_mode": "full_text|single_term_refinement",
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

If analysis_mode is "single_term_refinement", focus on the supplied term only.
Your main job is to decide whether the existing flag is justified. It is acceptable
and often correct to downgrade the term to LOW or SAFE. Do not search for extra
terms in this mode unless they are essential to explain the selected term.

## LINGUISTIC TRIAGE BEFORE RISK

Before assigning risk, classify why the term was flagged. Do not assume that every
word missing from dictionaries is foreign.

Downgrade to LOW or SAFE when the term is:
- a Russian abbreviation or compressed compound made from Russian words:
  "доппродажи" = "дополнительные продажи", "спеццена" = "специальная цена",
  "господдержка" = "государственная поддержка", "медуслуги" = "медицинские услуги";
- a normal Russian professional term that is Cyrillic and not a direct borrowing;
- an inflected Russian word, typo-like spelling, or industry shorthand whose parts
  are Russian and understandable;
- a brand, product name, company name, marketplace name, or proper noun.

Only keep HIGH/MEDIUM when there is clear evidence of a foreign borrowing or Latin
term that has a common Russian equivalent. If the connection with a foreign word is
only indirect or speculative, do not mark it HIGH.

For Russian compressed compounds, use:
- risk: "low" or "safe"
- keep_as_is: true
- replacements: []
- reason: explain that this is a Russian abbreviation/compound, not an anglicism.

Examples:
- "доппродажи": SAFE/LOW, not "upsell"; it is a Russian shortened form of
  "дополнительные продажи".
- "лидогенерация": MEDIUM/HIGH may be acceptable because it is a borrowed marketing term.
- "кейс": HIGH/MEDIUM in consumer advertising if it means "пример" or "ситуация".
- "AI": MEDIUM/LOW depending on context; may be a technical abbreviation, not always a violation.

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
        self.provider = os.getenv("LLM_PROVIDER", "deepseek").strip().lower()
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
                    return self._attach_sources(self._analyze_with_anthropic(text, context_type, flagged), flagged)
                return self._attach_sources(self._analyze_with_deepseek(text, context_type, flagged), flagged)
            except Exception as exc:
                logger.exception("%s analysis failed: %s", self.provider, exc)
                return self._fallback(text, context_type, flagged, llm_failed=True, llm_error=self._public_error(exc))
        return self._fallback(text, context_type, flagged)

    def status(self) -> dict[str, Any]:
        key = self.anthropic_api_key if self.provider == "anthropic" else self.deepseek_api_key
        return {
            "provider": self.provider,
            "configured": self._has_provider_key(),
            "model": self.anthropic_model if self.provider == "anthropic" else self.deepseek_model,
            "base_url": None if self.provider == "anthropic" else self.deepseek_base_url,
            "key_hint": self._key_hint(key),
            "max_text_chars": self.max_text_chars,
            "max_flagged_terms": self.max_flagged_terms,
        }

    def _llm_skip_reason(self, text: str, flagged: list[dict], use_llm: bool) -> str | None:
        if not use_llm:
            return "нейросетевой разбор отключен для этого запроса."
        if not flagged:
            return "нет спорных терминов для нейросетевого разбора."
        if len(text) > self.max_text_chars:
            return f"текст длиннее лимита нейросетевого разбора ({len(text)} > {self.max_text_chars} символов)."
        if len(flagged) > self.max_flagged_terms:
            return f"слишком много спорных терминов для одного нейросетевого запроса ({len(flagged)} > {self.max_flagged_terms})."
        return None

    def _has_provider_key(self) -> bool:
        if self.provider == "anthropic":
            return bool(self.anthropic_api_key)
        return bool(self.deepseek_api_key)

    def _payload(self, text: str, context_type: str, flagged: list[dict]) -> dict[str, Any]:
        return {
            "text": text,
            "context_type": context_type,
            "analysis_mode": "single_term_refinement" if len(flagged) == 1 else "full_text",
            "flagged_by_dictionary": [
                {
                    "term": item["term"],
                    "normalized": item["normalized"],
                    "script": item.get("script") or item.get("category", "missed_by_dictionary"),
                    "risk_base": item["risk"],
                    "known_replacements": item["replacements"],
                    "sources": item.get("sources", []),
                }
                for item in flagged
            ],
        }

    def _analyze_with_deepseek(self, text: str, context_type: str, flagged: list[dict]) -> dict[str, Any]:
        client = OpenAI(api_key=self.deepseek_api_key, base_url=self.deepseek_base_url, timeout=30)
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
        if "---SUMMARY---" in content:
            json_part, summary = content.split("---SUMMARY---", 1)
            data = json.loads(self._extract_json(json_part))
            summary_text = summary.strip()
        else:
            data = json.loads(self._extract_json(content))
            summary_text = data.get("summary", "")
        data["issues"] = self._dedupe_issues(data.get("issues", []))
        if not summary_text:
            summary_text = self._summary(
                data.get("issues", []),
                data.get("overall_risk", "safe"),
                bool(data.get("manual_review_required")),
                llm_failed=False,
                skip_reason=None,
            )
        data["summary"] = self._ensure_disclaimer(self._localize_summary(summary_text))
        return data

    def _fallback(
        self,
        text: str,
        context_type: str,
        flagged: list[dict],
        llm_failed: bool = False,
        skip_reason: str | None = None,
        llm_error: str | None = None,
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
                "sources": item.get("sources", []),
            }
            for item in flagged
            if item["risk"] != "safe"
        ]
        issues = self._dedupe_issues(issues)
        rewritten = self._rewrite(text, issues)
        overall = self.scorer.score(issues)
        manual, reason = self.scorer.needs_manual_review(context_type, issues)
        summary = self._summary(issues, overall, manual, llm_failed, skip_reason, llm_error)
        return {
            "overall_risk": overall,
            "issues": issues,
            "rewritten_text": rewritten,
            "summary": summary,
            "manual_review_required": manual,
            "manual_review_reason": reason,
        }

    @staticmethod
    def _attach_sources(data: dict[str, Any], flagged: list[dict]) -> dict[str, Any]:
        sources_by_normalized = {
            str(item.get("normalized", "")).lower(): item.get("sources", [])
            for item in flagged
            if item.get("normalized")
        }
        sources_by_term = {
            str(item.get("term", "")).lower(): item.get("sources", [])
            for item in flagged
            if item.get("term")
        }
        for issue in data.get("issues", []):
            if issue.get("sources"):
                continue
            normalized = str(issue.get("normalized", "")).lower()
            term = str(issue.get("term", "")).lower()
            sources = sources_by_normalized.get(normalized) or sources_by_term.get(term)
            issue["sources"] = sources or ["Найдено нейросетевым разбором; требуется ручная проверка источника."]
        data["issues"] = LLMAnalyzer._dedupe_issues(data.get("issues", []))
        return data

    @staticmethod
    def _dedupe_issues(issues: list[dict]) -> list[dict]:
        deduped: dict[tuple[str, str], dict] = {}
        risk_weight = {"safe": 0, "low": 1, "medium": 2, "high": 3}
        for issue in issues:
            key = (
                str(issue.get("normalized") or issue.get("term", "")).lower(),
                str(issue.get("category") or ""),
            )
            if key not in deduped:
                deduped[key] = issue
                continue
            current = deduped[key]
            if risk_weight.get(issue.get("risk"), 0) > risk_weight.get(current.get("risk"), 0):
                merged = {**issue}
                merged["sources"] = current.get("sources", []) + [
                    source for source in issue.get("sources", []) if source not in current.get("sources", [])
                ]
                deduped[key] = merged
            else:
                current_sources = current.setdefault("sources", [])
                for source in issue.get("sources", []):
                    if source not in current_sources:
                        current_sources.append(source)
                if not current.get("replacements") and issue.get("replacements"):
                    current["replacements"] = issue["replacements"]
        return list(deduped.values())

    @staticmethod
    def _rewrite(text: str, issues: list[dict]) -> str:
        rewritten = text
        for issue in sorted(issues, key=lambda item: len(item["term"]), reverse=True):
            if issue["risk"] not in {"high", "medium"} or not issue["replacements"]:
                continue
            replacement = issue["replacements"][0]
            rewritten = re.sub(rf"\b{re.escape(issue['term'])}\b", replacement, rewritten, flags=re.IGNORECASE)
        return rewritten

    @staticmethod
    def _extract_json(content: str) -> str:
        cleaned = content.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
            cleaned = re.sub(r"\s*```$", "", cleaned)
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise ValueError("LLM response does not contain a JSON object")
        return cleaned[start : end + 1]

    @staticmethod
    def _key_hint(key: str | None) -> str | None:
        if not key:
            return None
        if len(key) <= 10:
            return "***"
        return f"{key[:5]}...{key[-4:]}"

    @staticmethod
    def _public_error(exc: Exception) -> str:
        status_code = getattr(exc, "status_code", None)
        if status_code:
            if int(status_code) == 402:
                return "HTTP 402: DeepSeek отклонил запрос из-за оплаты или недостаточного баланса API"
            if int(status_code) == 401:
                return "HTTP 401: DeepSeek не принял API-ключ"
            if int(status_code) == 429:
                return "HTTP 429: превышен лимит запросов DeepSeek"
            if int(status_code) == 403:
                return "HTTP 403: API-провайдер запретил запрос. Проверьте доступ к модели, billing/credits и регион аккаунта."
            return f"HTTP {status_code}"
        message = str(exc).strip()
        if not message:
            return exc.__class__.__name__
        return message[:240]

    def _summary(self, issues: list[dict], overall: str, manual: bool, llm_failed: bool, skip_reason: str | None, llm_error: str | None = None) -> str:
        risk_label = RISK_LABELS.get(overall, overall)
        if not issues:
            base = f"Проблемных слов не найдено, общий риск: {risk_label}."
        else:
            critical = ", ".join(issue["term"] for issue in issues if issue["risk"] in {"high", "medium"})
            base = f"Найдено замечаний: {len(issues)}, общий риск: {risk_label}. Наиболее важные слова: {critical or 'нет'}."
        review = "Ручная проверка требуется." if manual else "Ручная проверка не требуется по автоматическим правилам."
        error_note = f" Причина: {llm_error}." if llm_failed and llm_error else ""
        fail_note = f" Нейросетевой анализ через {self.provider} недоступен, использована локальная проверка.{error_note}" if llm_failed else ""
        skip_note = f" Нейросетевой разбор не запускался: {skip_reason}" if skip_reason and issues else ""
        return self._ensure_disclaimer(f"{base} {review}{fail_note}{skip_note}")

    @staticmethod
    def _ensure_disclaimer(summary: str) -> str:
        disclaimer = "Это автоматическая оценка риска, не юридическое заключение."
        return summary if disclaimer in summary else f"{summary} {disclaimer}"

    @staticmethod
    def _localize_summary(summary: str) -> str:
        replacements = {
            r"\boverall risk\b": "общий риск",
            r"\bLLM[- ]?анализ\b": "нейросетевой анализ",
            r"\bLLM[- ]?разбор\b": "нейросетевой разбор",
            r"\bLLM\b": "нейросетевой разбор",
            r"\bDeepSeek\b": "нейросетевой сервис",
            r"\bhigh\b": "высокий",
            r"\bmedium\b": "средний",
            r"\blow\b": "низкий",
            r"\bsafe\b": "без замечаний",
        }
        localized = summary
        for pattern, replacement in replacements.items():
            localized = re.sub(pattern, replacement, localized, flags=re.IGNORECASE)
        return localized
