import re

TOKEN_PATTERN = re.compile(r"[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё-]*")


class TextPreprocessor:
    def clean(self, text: str) -> str:
        return re.sub(r"\s+", " ", text).strip()

    def tokenize(self, text: str) -> list[dict]:
        return [
            {"term": match.group(), "start": match.start(), "end": match.end()}
            for match in TOKEN_PATTERN.finditer(text)
        ]
