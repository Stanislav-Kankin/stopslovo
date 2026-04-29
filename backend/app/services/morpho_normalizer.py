try:
    import pymorphy3
except ImportError:  # pragma: no cover
    pymorphy3 = None


class MorphoNormalizer:
    def __init__(self) -> None:
        self._morph = pymorphy3.MorphAnalyzer() if pymorphy3 else None

    def normalize(self, word: str) -> str:
        lowered = word.lower().replace("ё", "е")
        if not self._morph or not self._is_cyrillic(lowered):
            return lowered
        parsed = self._morph.parse(lowered)
        return parsed[0].normal_form.replace("ё", "е") if parsed else lowered

    def is_known(self, word: str) -> bool:
        lowered = word.lower().replace("ё", "е")
        if not self._morph or not self._is_cyrillic(lowered):
            return False
        return any(parse.is_known for parse in self._morph.parse(lowered))

    @staticmethod
    def _is_cyrillic(word: str) -> bool:
        return any("а" <= char <= "я" or char == "ё" for char in word)
