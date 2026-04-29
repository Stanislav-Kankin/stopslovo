import argparse
import json
import re
import tempfile
import zipfile
from collections import defaultdict
from datetime import date
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "app" / "data" / "ran_lexicon.json"
SOURCE_ALIASES = {
    "orfograficheskij_slovar.pdf": "orthographic",
    "slovar_inostr_slov.pdf": "foreign",
    "orfoepicheskij_slovar.pdf": "orthoepic",
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


def main() -> None:
    parser = argparse.ArgumentParser(description="Build compact RAN lexicon JSON from dictionary PDFs")
    parser.add_argument("source", type=Path, help="Path to Archive zip, PDF, or directory with PDFs")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--max-pages", type=int, default=None, help="Debug limit")
    args = parser.parse_args()

    data = build(args.source, args.output, args.max_pages)
    print(f"Wrote {args.output}")
    print(f"Entries: {len(data['entries'])}")
    for item in data["stats"]:
        print(f"{item['file']}: {item['words']} words from {item['pages']} pages")


if __name__ == "__main__":
    main()
