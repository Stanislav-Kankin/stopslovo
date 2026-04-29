import json
from pathlib import Path


class RanLexicon:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or Path(__file__).resolve().parents[1] / "data" / "ran_lexicon.json"
        self.words: set[str] = set()
        if self.path.exists():
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            self.words = {entry["word"] for entry in raw.get("entries", [])}

    def contains(self, word: str) -> bool:
        normalized = word.lower().replace("ё", "е")
        return normalized in self.words
