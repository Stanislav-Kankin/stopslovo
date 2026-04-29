import json
from pathlib import Path

from app.services.risk_scorer import apply_context_modifier


class DictionaryChecker:
    def __init__(self, dictionary_path: Path | None = None) -> None:
        self.dictionary_path = dictionary_path or Path(__file__).resolve().parents[1] / "data" / "dictionary.json"
        raw = json.loads(self.dictionary_path.read_text(encoding="utf-8"))
        self.version = raw["version"]
        self.entries = raw["entries"]
        self.by_normalized = {entry["normalized"].lower().replace("ё", "е"): entry for entry in self.entries}

    def check(self, tokens: list[dict], latin_matches: list[dict], normalizer, context_type: str) -> list[dict]:
        found: dict[tuple[str, int | None], dict] = {}

        for match in latin_matches:
            normalized = match["term"].lower()
            entry = self.by_normalized.get(normalized)
            if entry:
                found[(match["term"].lower(), match["start"])] = self._issue(match, entry, context_type)
            else:
                risk = apply_context_modifier("medium", context_type)
                found[(match["term"].lower(), match["start"])] = {
                    "term": match["term"],
                    "normalized": normalized,
                    "script": "latin",
                    "category": "missed_by_dictionary",
                    "risk": risk,
                    "risk_base": risk,
                    "reason": "Латинское слово отсутствует в словаре; нужно проверить, не является ли оно брендом, товарным знаком или заменяемым иностранным словом.",
                    "replacements": [],
                    "keep_as_is": True,
                    "start": match.get("start"),
                    "end": match.get("end"),
                }

        for token in tokens:
            normalized = normalizer.normalize(token["term"])
            entry = self.by_normalized.get(normalized)
            if not entry or entry["risk_base"] == "safe":
                continue
            found[(token["term"].lower(), token["start"])] = self._issue(
                {**token, "normalized": normalized},
                entry,
                context_type,
            )

        return list(found.values())

    def _issue(self, token: dict, entry: dict, context_type: str) -> dict:
        risk = apply_context_modifier(entry["risk_base"], context_type)
        return {
            "term": token["term"],
            "normalized": entry["normalized"],
            "script": entry["script"],
            "category": entry["script"],
            "risk": risk,
            "risk_base": risk,
            "reason": self._reason(entry, risk),
            "replacements": entry["replacements"],
            "keep_as_is": risk in {"low", "safe"} or not entry["replacements"],
            "start": token.get("start"),
            "end": token.get("end"),
        }

    @staticmethod
    def _reason(entry: dict, risk: str) -> str:
        if risk == "high":
            return "Иностранное или заимствованное слово имеет понятные русские замены и может быть рискованным в потребительском тексте."
        if risk == "medium":
            return "Заимствование выглядит спорным: русская замена есть, но контекст и привычность слова требуют оценки."
        if risk == "low":
            return "Слово может быть допустимым в этом контексте, потому что замена не всегда звучит естественно."
        return "Слово считается освоенным или не требует замены."
