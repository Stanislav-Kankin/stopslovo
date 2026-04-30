import re
from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlmodel import Session

from app.api.v1.auth import get_user_from_request
from app.api.v1.schemas import CheckBatchRequest, CheckBatchResponse, CheckTextRequest, CheckTextResponse, RefineIssueRequest, RefineIssueResponse
from app.db import get_session
from app.models.user import User
from app.services.dictionary_checker import DictionaryChecker
from app.services.latin_detector import LatinDetector
from app.services.llm_analyzer import LLMAnalyzer
from app.services.morpho_normalizer import MorphoNormalizer
from app.services.preprocessor import TextPreprocessor
from app.services.quota import check_quota
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
ANON_COOKIE = "stopslovo_anon_id"


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


def _active_plan(user: User | None) -> str:
    if not user:
        return "anon"
    if user.plan_expires_at and user.plan_expires_at < datetime.utcnow():
        return "free"
    return user.plan


def _quota_identity(request: Request, response: Response, session: Session) -> tuple[str, str]:
    user = get_user_from_request(request, session)
    if user:
        return user.id, _active_plan(user)
    anon_id = request.cookies.get(ANON_COOKIE) or str(uuid4())
    response.set_cookie(ANON_COOKIE, anon_id, max_age=365 * 24 * 60 * 60, httponly=True, samesite="lax")
    return f"anon:{anon_id}", "anon"


def _quota_error() -> JSONResponse:
    return JSONResponse(
        status_code=402,
        content={
            "error": "quota_exceeded",
            "message": "Исчерпан лимит на этот месяц. Обновите тариф.",
            "upgrade_url": "/pricing",
        },
    )


def _word_count(text: str) -> int:
    return len(re.findall(r"[\wА-Яа-яЁё-]+", text, flags=re.UNICODE))


def _refine_explanation(issue: dict, summary: str) -> str:
    risk = {
        "high": "высокий",
        "medium": "средний",
        "low": "низкий",
        "safe": "без замечаний",
    }.get(issue.get("risk"), issue.get("risk", ""))
    replacements = issue.get("replacements") or []
    replacement_text = f" Рекомендуемые замены: {', '.join(replacements)}." if replacements else ""
    reason = issue.get("reason") or summary
    return f"ИИ уточнил термин «{issue.get('term', '')}»: риск — {risk}. {reason}{replacement_text}".strip()


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
def check_text(
    payload: CheckTextRequest,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
) -> dict | JSONResponse:
    user_id, plan = _quota_identity(request, response, session)
    if not check_quota(session, user_id, plan, chars=_word_count(payload.text), rows=0):
        return _quota_error()
    return process_request(payload)


@router.post("/batch", response_model=CheckBatchResponse)
def check_batch(
    payload: CheckBatchRequest,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
) -> dict | JSONResponse:
    user_id, plan = _quota_identity(request, response, session)
    if not check_quota(session, user_id, plan, chars=0, rows=len(payload.items)):
        return _quota_error()
    return {"items": [process_request(item) for item in payload.items]}


@router.get("/llm/status")
def llm_status() -> dict:
    return llm.status()


@router.post("/refine", response_model=RefineIssueResponse)
def refine_issue(
    payload: RefineIssueRequest,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
) -> dict | JSONResponse:
    user_id, plan = _quota_identity(request, response, session)
    if not check_quota(session, user_id, plan, chars=_word_count(payload.text), rows=0):
        return _quota_error()
    clean_text = preprocessor.clean(payload.text)
    issue = payload.issue.model_dump()
    analysis = llm.analyze(clean_text, payload.context_type, [issue], use_llm=True)
    refined_issue = analysis["issues"][0] if analysis["issues"] else issue
    llm_explanation = _refine_explanation(refined_issue, analysis["summary"])
    refined_issue["ai_refined"] = True
    refined_issue["ai_summary"] = llm_explanation
    return {
        "issue": refined_issue,
        "summary": analysis["summary"],
        "llm_explanation": llm_explanation,
        "rewritten_text": analysis["rewritten_text"],
        "manual_review_required": analysis["manual_review_required"],
        "manual_review_reason": analysis.get("manual_review_reason"),
    }


@router.get("/{result_id}", response_model=CheckTextResponse)
def get_result(result_id: str) -> dict:
    result = RESULTS.get(result_id)
    if not result:
        raise HTTPException(status_code=404, detail="Result not found")
    return result
