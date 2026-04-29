import argparse
import json
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DICTIONARY_PATH = ROOT / "app" / "data" / "dictionary.json"
VALID_SCRIPTS = {"latin", "cyrillic_borrowing"}
VALID_RISKS = {"high", "medium", "low", "safe"}


def load_dictionary() -> dict:
    return json.loads(DICTIONARY_PATH.read_text(encoding="utf-8"))


def save_dictionary(data: dict) -> None:
    data["updated"] = date.today().isoformat()
    DICTIONARY_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def normalize_key(value: str) -> str:
    return value.strip().lower().replace("ё", "е")


def validate(data: dict) -> list[str]:
    errors: list[str] = []
    seen: set[str] = set()
    for index, entry in enumerate(data.get("entries", []), start=1):
        prefix = f"entry #{index}"
        for field in ("term", "normalized", "script", "category", "risk_base", "replacements"):
            if field not in entry:
                errors.append(f"{prefix}: missing field {field}")
        if entry.get("script") not in VALID_SCRIPTS:
            errors.append(f"{prefix}: script must be one of {sorted(VALID_SCRIPTS)}")
        if entry.get("risk_base") not in VALID_RISKS:
            errors.append(f"{prefix}: risk_base must be one of {sorted(VALID_RISKS)}")
        if not isinstance(entry.get("replacements"), list):
            errors.append(f"{prefix}: replacements must be a list")
        key = normalize_key(str(entry.get("normalized", "")))
        if key in seen:
            errors.append(f"{prefix}: duplicate normalized value {key}")
        seen.add(key)
    return errors


def add_entry(args: argparse.Namespace) -> None:
    data = load_dictionary()
    normalized = normalize_key(args.normalized or args.term)
    entries = data.setdefault("entries", [])
    if any(normalize_key(entry["normalized"]) == normalized for entry in entries):
        raise SystemExit(f"Entry already exists: {normalized}")

    entries.append(
        {
            "term": args.term.strip(),
            "normalized": normalized,
            "script": args.script,
            "category": args.category.strip(),
            "risk_base": args.risk,
            "replacements": [item.strip() for item in args.replacement if item.strip()],
        }
    )
    errors = validate(data)
    if errors:
        raise SystemExit("\n".join(errors))
    save_dictionary(data)
    print(f"Added {normalized}. Total entries: {len(entries)}")


def validate_command(_: argparse.Namespace) -> None:
    data = load_dictionary()
    errors = validate(data)
    if errors:
        raise SystemExit("\n".join(errors))
    print(f"Dictionary is valid. Entries: {len(data.get('entries', []))}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Maintain StopSlovo dictionary.json")
    subparsers = parser.add_subparsers(required=True)

    validate_parser = subparsers.add_parser("validate", help="Validate dictionary schema and duplicates")
    validate_parser.set_defaults(func=validate_command)

    add_parser = subparsers.add_parser("add", help="Add one dictionary entry")
    add_parser.add_argument("--term", required=True)
    add_parser.add_argument("--normalized")
    add_parser.add_argument("--script", required=True, choices=sorted(VALID_SCRIPTS))
    add_parser.add_argument("--category", required=True)
    add_parser.add_argument("--risk", required=True, choices=sorted(VALID_RISKS))
    add_parser.add_argument("--replacement", action="append", default=[])
    add_parser.set_defaults(func=add_entry)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
