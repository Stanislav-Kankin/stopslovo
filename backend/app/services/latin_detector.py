import re

LATIN_PATTERN = re.compile(r"\b[a-zA-Z]{2,}\b")
URL_PATTERN = re.compile(r"https?://\S+|www\.\S+|\b[\w.-]+\.[a-zA-Z]{2,}\b", re.IGNORECASE)


class LatinDetector:
    def detect(self, text: str) -> list[dict]:
        ignored_spans = [(match.start(), match.end()) for match in URL_PATTERN.finditer(text)]
        return [
            {"term": match.group(), "start": match.start(), "end": match.end()}
            for match in LATIN_PATTERN.finditer(text)
            if not any(start <= match.start() and match.end() <= end for start, end in ignored_spans)
        ]
