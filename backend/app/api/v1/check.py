import re

from fastapi import APIRouter, HTTPException

from app.api.v1.schemas import CheckBatchRequest, CheckBatchResponse, CheckTextRequest, CheckTextResponse
from app.services.dictionary_checker import DictionaryChecker
from app.services.latin_detector import LatinDetector
from app.services.llm_analyzer import LLMAnalyzer
from app.services.morpho_normalizer import MorphoNormalizer
from app.services.preprocessor import TextPreprocessor
from app.services.ran_lexicon import RanLexicon
from app.services.report_generator import ReportGenerator

router = APIRouter(prefix="/api/v1/check", tags=["check"])

preprocessor = TextPreprocessor()
latin_detector = LatinDetector()
normalizer = MorphoNormalizer()
ran_lexicon = RanLexicon()
dictionary = DictionaryChecker()
llm = LLMAnalyzer()
reporter = ReportGenerator()
RESULTS: dict[str, dict] = {}


def _excluded_spans(text: str, excluded_terms: list[str]) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    for raw_term in excluded_terms:
        term = " ".join(raw_term.split())
        if not term:
            continue
        pattern = re.compile(rf"(?<![\w-]){re.escape(term)}(?![\w-])", re.IGNORECASE)
        spans.extend((match.start(), match.end()) for match in pattern.finditer(text))
    return spans


def _inside_spans(item: dict, spans: list[tuple[int, int]]) -> bool:
    start = item.get("start")
    end = item.get("end")
    return start is not None and end is not None and any(span_start <= start and end <= span_end for span_start, span_end in spans)


def process_request(payload: CheckTextRequest) -> dict:
    clean_text = preprocessor.clean(payload.text)
    tokens = preprocessor.tokenize(clean_text)
    latin = latin_detector.detect(clean_text)
    excluded_spans = _excluded_spans(clean_text, payload.excluded_terms)
    if excluded_spans:
        tokens = [token for token in tokens if not _inside_spans(token, excluded_spans)]
        latin = [match for match in latin if not _inside_spans(match, excluded_spans)]
    flagged = dictionary.check(tokens, latin, normalizer, payload.context_type, ran_lexicon)
    analysis = llm.analyze(clean_text, payload.context_type, flagged, use_llm=payload.use_llm)
    result = reporter.build(clean_text, payload.request_id, analysis)
    RESULTS[result["request_id"]] = result
    return result


@router.post("/text", response_model=CheckTextResponse)
def check_text(payload: CheckTextRequest) -> dict:
    return process_request(payload)


@router.post("/batch", response_model=CheckBatchResponse)
def check_batch(payload: CheckBatchRequest) -> dict:
    return {"items": [process_request(item) for item in payload.items]}


@router.get("/{result_id}", response_model=CheckTextResponse)
def get_result(result_id: str) -> dict:
    result = RESULTS.get(result_id)
    if not result:
        raise HTTPException(status_code=404, detail="Result not found")
    return result
