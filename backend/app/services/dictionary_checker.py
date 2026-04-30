import json
from pathlib import Path

from app.services.risk_scorer import apply_context_modifier


RAN_SOURCE_NOTE = (
    "Не найдено в словарях РАН: орфографическом, орфоэпическом, словаре иностранных слов "
    "и толковом словаре государственного языка."
)


class DictionaryChecker:
    def __init__(self, dictionary_path: Path | None = None) -> None:
        self.dictionary_path = dictionary_path or Path(__file__).resolve().parents[1] / "data" / "dictionary.json"
        raw = json.loads(self.dictionary_path.read_text(encoding="utf-8"))
        self.version = raw["version"]
        self.entries = raw["entries"]
        self.by_normalized = {entry["normalized"].lower().replace("ё", "е"): entry for entry in self.entries}
        registered_path = self.dictionary_path.with_name("registered_names.json")
        if registered_path.exists():
            registered = json.loads(registered_path.read_text(encoding="utf-8"))
            self.registered_names = {item.lower().replace("ё", "е") for item in registered.get("names", [])}
        else:
            self.registered_names = set()
        self.allowlist_path = self.dictionary_path.with_name("global_allowlist.json")

    def global_allowlist(self) -> list[str]:
        if not self.allowlist_path.exists():
            return []
        try:
            raw = json.loads(self.allowlist_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return []
        return [
            " ".join(str(item).split())
            for item in raw.get("terms", [])
            if " ".join(str(item).split())
        ]

    def global_allowlist_set(self) -> set[str]:
        return {item.lower().replace("ё", "е") for item in self.global_allowlist()}

    def check(self, tokens: list[dict], latin_matches: list[dict], normalizer, context_type: str, ran_lexicon=None) -> list[dict]:
        found: dict[tuple[str, str], dict] = {}
        global_allowlist = self.global_allowlist_set()

        for match in latin_matches:
            normalized = match["term"].lower()
            if normalized in self.registered_names or normalized in global_allowlist:
                continue
            entry = self.by_normalized.get(normalized)
            if entry:
                found.setdefault((normalized, "latin"), self._issue(match, entry, context_type))
            else:
                found.setdefault((normalized, "latin"), {
                    "term": match["term"],
                    "normalized": normalized,
                    "script": "latin",
                    "category": "missed_by_dictionary",
                    "risk": "medium",
                    "risk_base": "medium",
                    "reason": "Латинское слово отсутствует в словаре; нужно проверить, не является ли оно брендом, товарным знаком или заменяемым иностранным словом.",
                    "replacements": [],
                    "sources": [
                        f"Локальный словарь англицизмов и заимствований СтопСлово v{self.version}: слово не найдено.",
                        RAN_SOURCE_NOTE,
                    ],
                    "keep_as_is": True,
                    "start": match.get("start"),
                    "end": match.get("end"),
                })

        for token in tokens:
            if not self._has_cyrillic(token["term"]):
                continue
            if self._is_cyrillic_abbreviation(token["term"]):
                continue
            normalized = normalizer.normalize(token["term"])
            if normalized in self.registered_names or normalized in global_allowlist or token["term"].lower().replace("ё", "е") in global_allowlist:
                continue
            entry = self.by_normalized.get(normalized)
            if entry and entry["risk_base"] == "safe":
                continue
            if entry:
                found.setdefault(
                    (normalized, entry["script"]),
                    self._issue(
                        {**token, "normalized": normalized},
                        entry,
                        context_type,
                    ),
                )
                continue
            if self._looks_like_russian_compressed_compound(normalized):
                continue
            if self._looks_like_russian_derivative(normalized):
                continue
            if normalizer.is_known(token["term"]) or (ran_lexicon and ran_lexicon.contains(normalized)):
                continue
            found.setdefault((normalized, "cyrillic_borrowing"), {
                "term": token["term"],
                "normalized": normalized,
                "script": "cyrillic_borrowing",
                "category": "missed_by_dictionary",
                "risk": "medium",
                "risk_base": "medium",
                "reason": "Слово не найдено в нормативной морфологии и белом списке; нужен контекстный разбор, не является ли оно брендом, опечаткой или заимствованием.",
                "replacements": [],
                "sources": [
                    "pymorphy3: слово не распознано как известная русская форма.",
                    RAN_SOURCE_NOTE,
                ],
                "keep_as_is": True,
                "start": token.get("start"),
                "end": token.get("end"),
            })

        return list(found.values())

    @staticmethod
    def _has_cyrillic(value: str) -> bool:
        return any("а" <= char.lower() <= "я" or char.lower() == "ё" for char in value)

    @classmethod
    def _is_cyrillic_abbreviation(cls, value: str) -> bool:
        letters = [char for char in value if char.isalpha()]
        return len(letters) >= 2 and all(cls._has_cyrillic(char) and char.isupper() for char in letters)

    @staticmethod
    def _looks_like_russian_compressed_compound(value: str) -> bool:
        normalized = value.lower().replace("ё", "е")
        russian_prefixes = (
            "авто",
            "агро",
            "гос",
            "доп",
            "евро",
            "мед",
            "меж",
            "мин",
            "мульт",
            "общ",
            "орг",
            "проф",
            "само",
            "сель",
            "соц",
            "спец",
            "строй",
            "тех",
            "фин",
            "электро",
        )
        return len(normalized) >= 7 and normalized.startswith(russian_prefixes)

    @staticmethod
    def _looks_like_russian_derivative(value: str) -> bool:
        normalized = value.lower().replace("ё", "е")
        russian_stems = (
            "масштаб",
        )
        russian_suffixes = (
            "ировать",
            "ироваться",
            "ированный",
            "ированная",
            "ированные",
            "ирование",
            "ируемый",
            "ируемая",
            "ируемые",
        )
        return normalized.startswith(russian_stems) and (
            normalized.endswith(russian_suffixes) or normalized in russian_stems
        )

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
            "sources": [
                f"Локальный словарь англицизмов и заимствований СтопСлово v{self.version}.",
                f"Категория словаря: {entry.get('category', 'не указана')}.",
            ],
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
