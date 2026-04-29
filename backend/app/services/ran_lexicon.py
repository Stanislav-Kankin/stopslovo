import json
import sqlite3
from pathlib import Path


class RanLexicon:
    def __init__(self, path: Path | None = None) -> None:
        data_dir = Path(__file__).resolve().parents[1] / "data"
        self.sqlite_path = data_dir / "lexicon.sqlite"
        self.path = path or data_dir / "ran_lexicon.json"
        self.words: set[str] = set()
        self._use_sqlite = self.sqlite_path.exists()
        self._connection = None
        if self._use_sqlite:
            self._connection = sqlite3.connect(f"file:{self.sqlite_path}?mode=ro", uri=True, check_same_thread=False)
        if not self._use_sqlite and self.path.exists():
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            self.words = {entry["word"] for entry in raw.get("entries", [])}

    def contains(self, word: str) -> bool:
        normalized = word.lower().replace("ё", "е")
        if self._connection:
            row = self._connection.execute("SELECT 1 FROM words WHERE word = ? LIMIT 1", (normalized,)).fetchone()
            return row is not None
        return normalized in self.words
