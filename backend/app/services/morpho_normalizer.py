import inspect
from collections import namedtuple

if not hasattr(inspect, "getargspec"):
    ArgSpec = namedtuple("ArgSpec", "args varargs keywords defaults")

    def getargspec(func):  # type: ignore[no-untyped-def]
        spec = inspect.getfullargspec(func)
        return ArgSpec(spec.args, spec.varargs, spec.varkw, spec.defaults)

    inspect.getargspec = getargspec  # type: ignore[attr-defined]

try:
    import pymorphy2
except ImportError:  # pragma: no cover
    pymorphy2 = None


class MorphoNormalizer:
    def __init__(self) -> None:
        self._morph = pymorphy2.MorphAnalyzer() if pymorphy2 else None

    def normalize(self, word: str) -> str:
        lowered = word.lower().replace("ё", "е")
        if not self._morph or not self._is_cyrillic(lowered):
            return lowered
        parsed = self._morph.parse(lowered)
        return parsed[0].normal_form.replace("ё", "е") if parsed else lowered

    @staticmethod
    def _is_cyrillic(word: str) -> bool:
        return any("а" <= char <= "я" or char == "ё" for char in word)
