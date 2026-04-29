import argparse
import json
import re
import sqlite3
import tempfile
import zipfile
from collections import defaultdict
from datetime import date
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "app" / "data" / "ran_lexicon.json"
DEFAULT_SQLITE = ROOT / "app" / "data" / "lexicon.sqlite"
SOURCE_ALIASES = {
    "orfograficheskij_slovar.pdf": "orthographic",
    "slovar_inostr_slov.pdf": "foreign",
    "orfoepicheskij_slovar.pdf": "orthoepic",
    "tolkovyj_slovar_chast1_A-N.pdf": "explanatory",
    "tolkovyj_slovar_chast2_O-Ja.pdf": "explanatory",
}
SOURCE_TITLES = {
    "orthographic": "Орфографический словарь русского языка как государственного языка РФ",
    "orthoepic": "Орфоэпический словарь русского языка как государственного языка РФ",
    "foreign": "Словарь иностранных слов",
    "explanatory": "Толковый словарь государственного языка Российской Федерации",
}
CYRILLIC_WORD_RE = re.compile(r"^[а-яё][а-яё-]{1,}$", re.IGNORECASE)
NOISE_WORDS = {
    "аббревиатура",
    "академия",
    "государственного",
    "издательство",
    "институт",
    "литературного",
    "министерство",
    "предисловие",
    "приложение",
    "российская",
    "российской",
    "русского",
    "словарь",
    "страница",
    "федерации",
    "языка",
}


def normalize_word(value: str) -> str:
    value = value.lower().replace("ё", "е")
    value = re.sub(r"[́`']", "", value)
    value = value.strip("-–—.,;:!?()[]{}«»\" ")
    return value


def is_candidate(value: str) -> bool:
    word = normalize_word(value)
    if not CYRILLIC_WORD_RE.match(word):
        return False
    if word in NOISE_WORDS:
        return False
    if len(word) < 2 or len(word) > 40:
        return False
    if "--" in word:
        return False
    return True


def iter_pdf_paths(source: Path) -> list[Path]:
    if source.is_dir():
        return sorted(source.glob("*.pdf"))
    if source.suffix.lower() == ".pdf":
        return [source]
    if source.suffix.lower() != ".zip":
        raise SystemExit("Source must be a PDF, a directory with PDFs, or a zip archive")

    temp_dir = Path(tempfile.mkdtemp(prefix="ran_lexicon_"))
    with zipfile.ZipFile(source) as archive:
        for entry in archive.infolist():
            if entry.filename.startswith("__MACOSX/") or not entry.filename.lower().endswith(".pdf"):
                continue
            target = temp_dir / Path(entry.filename).name
            target.write_bytes(archive.read(entry))
    return sorted(temp_dir.glob("*.pdf"))


def extract_words_from_text(text: str) -> set[str]:
    text = re.sub(r"([а-яё])-\\s+([а-яё])", r"\1\2", text, flags=re.IGNORECASE)
    text = text.replace("\u00ad", "")
    words: set[str] = set()

    for line in text.splitlines():
        cleaned = line.strip()
        if not cleaned:
            continue
        first = re.split(r"\s|,|;|\(|\[", cleaned, maxsplit=1)[0]
        if is_candidate(first):
            words.add(normalize_word(first))
    return words


def build(source: Path, output: Path, max_pages: int | None = None) -> dict:
    by_word: dict[str, set[str]] = defaultdict(set)
    stats = []

    for pdf_path in iter_pdf_paths(source):
        source_name = SOURCE_ALIASES.get(pdf_path.name, pdf_path.stem)
        reader = PdfReader(str(pdf_path))
        page_count = len(reader.pages) if max_pages is None else min(len(reader.pages), max_pages)
        source_words: set[str] = set()
        for index in range(page_count):
            text = reader.pages[index].extract_text() or ""
            source_words.update(extract_words_from_text(text))

        for word in source_words:
            by_word[word].add(source_name)
        stats.append({"file": pdf_path.name, "source": source_name, "pages": page_count, "words": len(source_words)})

    entries = [
        {"word": word, "sources": sorted(sources)}
        for word, sources in sorted(by_word.items())
    ]
    data = {
        "version": "1.0",
        "updated": date.today().isoformat(),
        "description": "Extracted offline from RAN dictionary PDFs. Used as an auxiliary normative lexicon.",
        "stats": stats,
        "entries": entries,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return data


def write_sqlite(data: dict, sqlite_path: Path) -> None:
    sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    if sqlite_path.exists():
        sqlite_path.unlink()

    connection = sqlite3.connect(sqlite_path)
    try:
        connection.execute("PRAGMA journal_mode=OFF")
        connection.execute("PRAGMA synchronous=OFF")
        connection.execute(
            """
            CREATE TABLE meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE sources (
                code TEXT PRIMARY KEY,
                title TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE words (
                word TEXT PRIMARY KEY
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE word_sources (
                word TEXT NOT NULL,
                source TEXT NOT NULL,
                PRIMARY KEY (word, source),
                FOREIGN KEY (word) REFERENCES words(word),
                FOREIGN KEY (source) REFERENCES sources(code)
            )
            """
        )
        connection.executemany(
            "INSERT INTO meta(key, value) VALUES (?, ?)",
            [
                ("version", data["version"]),
                ("updated", data["updated"]),
                ("description", data["description"]),
                ("entries", str(len(data["entries"]))),
                ("stats", json.dumps(data["stats"], ensure_ascii=False)),
            ],
        )
        sources = sorted({source for entry in data["entries"] for source in entry["sources"]})
        connection.executemany(
            "INSERT INTO sources(code, title) VALUES (?, ?)",
            [(source, SOURCE_TITLES.get(source, source)) for source in sources],
        )
        connection.executemany("INSERT INTO words(word) VALUES (?)", [(entry["word"],) for entry in data["entries"]])
        connection.executemany(
            "INSERT INTO word_sources(word, source) VALUES (?, ?)",
            [(entry["word"], source) for entry in data["entries"] for source in entry["sources"]],
        )
        connection.execute("CREATE INDEX idx_word_sources_source ON word_sources(source)")
        connection.commit()
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Build compact RAN lexicon JSON from dictionary PDFs")
    parser.add_argument("source", type=Path, help="Path to Archive zip, PDF, or directory with PDFs")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--sqlite-output", type=Path, default=DEFAULT_SQLITE)
    parser.add_argument("--no-json", action="store_true", help="Build SQLite only")
    parser.add_argument("--max-pages", type=int, default=None, help="Debug limit")
    args = parser.parse_args()

    data = build(args.source, args.output, args.max_pages)
    write_sqlite(data, args.sqlite_output)
    if args.no_json and args.output.exists():
        args.output.unlink()
    else:
        print(f"Wrote {args.output}")
    print(f"Wrote {args.sqlite_output}")
    print(f"Entries: {len(data['entries'])}")
    for item in data["stats"]:
        print(f"{item['file']}: {item['words']} words from {item['pages']} pages")


if __name__ == "__main__":
    main()
