import re

LATIN_PATTERN = re.compile(r"\b[a-zA-Z]{2,}\b")


class LatinDetector:
    def detect(self, text: str) -> list[dict]:
        return [
            {"term": match.group(), "start": match.start(), "end": match.end()}
            for match in LATIN_PATTERN.finditer(text)
        ]
