import json
import re
from datetime import datetime, timedelta
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlmodel import Session, select

from app.api.v1.auth import get_user_from_request
from app.api.v1.schemas import CheckBatchRequest, CheckBatchResponse, CheckTextRequest, CheckTextResponse, RefineIssueRequest, RefineIssueResponse
from app.db import get_session
from app.models.user import CheckResult, SharedReport, User
from app.services.dictionary_checker import DictionaryChecker
from app.services.latin_detector import LatinDetector
from app.services.llm_analyzer import LLMAnalyzer
from app.services.morpho_normalizer import MorphoNormalizer
from app.services.preprocessor import TextPreprocessor
from app.services.quota import active_plan, check_ai_quota, check_quota, has_ai_quota
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
ANON_COOKIE = "stopslovo_anon_id"
RESULT_TTL_HOURS = 24
SHARE_TTL_DAYS = 14


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


def _quota_identity(request: Request, response: Response, session: Session) -> tuple[str, str, datetime | None]:
    user = get_user_from_request(request, session)
    if user:
        return user.id, active_plan(user), user.created_at
    anon_id = request.cookies.get(ANON_COOKIE) or str(uuid4())
    response.set_cookie(ANON_COOKIE, anon_id, max_age=365 * 24 * 60 * 60, httponly=True, samesite="lax")
    return f"anon:{anon_id}", "anon", None


def _quota_error() -> JSONResponse:
    return JSONResponse(
        status_code=402,
        content={
            "error": "quota_exceeded",
            "message": "Исчерпан лимит на этот месяц. Обновите тариф.",
            "upgrade_url": "/pricing",
        },
    )


def _ai_quota_error(status_code: int = 402) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error": "ai_quota_exceeded",
            "message": "ИИ-подсказки недоступны на текущем тарифе или лимит на этот месяц исчерпан.",
            "upgrade_url": "/pricing",
        },
    )


def _ai_unavailable_error(reason: str | None = None) -> JSONResponse:
    message = "ИИ сейчас не смог обработать уточнение. Попробуйте позже."
    if reason:
        message = f"{message} Причина: {reason}"
    return JSONResponse(
        status_code=503,
        content={
            "error": "llm_unavailable",
            "message": message,
        },
    )


def _term_context(text: str, term: str | None, max_chars: int = 3500) -> str:
    if len(text) <= max_chars:
        return text
    if not term:
        return text[:max_chars]

    match = re.search(re.escape(term), text, flags=re.IGNORECASE)
    if not match:
        return text[:max_chars]

    half = max_chars // 2
    start = max(0, match.start() - half)
    end = min(len(text), start + max_chars)
    start = max(0, end - max_chars)
    return text[start:end]


def _word_count(text: str) -> int:
    return len(re.findall(r"[\wА-Яа-яЁё-]+", text, flags=re.UNICODE))


def _save_result(session: Session, result: dict) -> None:
    stored = {key: value for key, value in result.items() if not key.startswith("_")}
    cutoff = datetime.utcnow() - timedelta(hours=RESULT_TTL_HOURS)
    old_results = session.exec(select(CheckResult).where(CheckResult.created_at < cutoff).limit(100)).all()
    for old_result in old_results:
        session.delete(old_result)
    session.merge(
        CheckResult(
            id=stored["request_id"],
            data_json=json.dumps(stored, ensure_ascii=False, default=str),
            created_at=datetime.utcnow(),
        )
    )
    session.commit()


def _cleanup_shared_reports(session: Session) -> None:
    cutoff = datetime.utcnow() - timedelta(days=SHARE_TTL_DAYS)
    old_reports = session.exec(select(SharedReport).where(SharedReport.created_at < cutoff).limit(100)).all()
    for old_report in old_reports:
        session.delete(old_report)
    if old_reports:
        session.commit()


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
    excluded_spans = _excluded_spans(clean_text, payload.excluded_terms + dictionary.global_allowlist())
    if excluded_spans:
        tokens = [token for token in tokens if not _inside_spans(token, excluded_spans)]
        latin = [match for match in latin if not _inside_spans(match, excluded_spans)]
    flagged = dictionary.check(tokens, latin, normalizer, payload.context_type, ran_lexicon)
    analysis = llm.analyze(clean_text, payload.context_type, flagged, use_llm=payload.use_llm)
    result = reporter.build(clean_text, payload.request_id, analysis)
    result["_llm_used"] = bool(analysis.get("llm_used"))
    return result


@router.post("/text", response_model=CheckTextResponse)
def check_text(
    payload: CheckTextRequest,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
) -> dict | JSONResponse:
    user = get_user_from_request(request, session)
    user_id, plan, quota_started_at = _quota_identity(request, response, session)
    if not check_quota(session, user_id, plan, chars=_word_count(payload.text), rows=0, started_at=quota_started_at):
        return _quota_error()
    effective_payload = payload
    if payload.use_llm:
        if not user:
            effective_payload = payload.model_copy(update={"use_llm": False})
        elif not has_ai_quota(session, user.id, active_plan(user), started_at=user.created_at):
            effective_payload = payload.model_copy(update={"use_llm": False})
    result = process_request(effective_payload)
    if result.get("_llm_used") and user:
        check_ai_quota(session, user.id, active_plan(user), started_at=user.created_at)
    result.pop("_llm_used", None)
    _save_result(session, result)
    return result


@router.post("/batch", response_model=CheckBatchResponse)
def check_batch(
    payload: CheckBatchRequest,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
) -> dict | JSONResponse:
    user = get_user_from_request(request, session)
    user_id, plan, quota_started_at = _quota_identity(request, response, session)
    if not check_quota(session, user_id, plan, chars=0, rows=len(payload.items), started_at=quota_started_at):
        return _quota_error()
    llm_items_count = sum(1 for item in payload.items if item.use_llm)
    use_llm_in_batch = bool(user and llm_items_count and has_ai_quota(session, user.id, active_plan(user), amount=llm_items_count, started_at=user.created_at))
    items = []
    llm_used_count = 0
    for item in payload.items:
        effective_item = item if use_llm_in_batch else item.model_copy(update={"use_llm": False})
        result = process_request(effective_item)
        llm_used_count += 1 if result.get("_llm_used") else 0
        result.pop("_llm_used", None)
        _save_result(session, result)
        items.append(result)
    if llm_used_count and user:
        check_ai_quota(session, user.id, active_plan(user), amount=llm_used_count, started_at=user.created_at)
    return {"items": items}


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
    user = get_user_from_request(request, session)
    if not user:
        return _ai_quota_error(status_code=401)
    user_id, plan = user.id, active_plan(user)
    if not has_ai_quota(session, user_id, plan, started_at=user.created_at):
        return _ai_quota_error()
    clean_text = preprocessor.clean(payload.text)
    issue = payload.issue.model_dump()
    llm_text = _term_context(clean_text, issue.get("term") or issue.get("normalized"))
    analysis = llm.analyze(llm_text, payload.context_type, [issue], use_llm=True)
    llm_used = bool(analysis.get("llm_used"))
    if not llm_used:
        return _ai_unavailable_error(analysis.get("summary"))

    check_ai_quota(session, user_id, plan, started_at=user.created_at)
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
        "llm_used": llm_used,
    }


@router.post("/share")
def create_shared_report(payload: dict, session: Session = Depends(get_session)) -> dict:
    kind = payload.get("kind")
    data = payload.get("data")
    if kind not in {"single", "batch"} or not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Некорректный отчёт для публикации")
    _cleanup_shared_reports(session)
    report = SharedReport(
        kind=kind,
        data_json=json.dumps(data, ensure_ascii=False, default=str),
    )
    session.add(report)
    session.commit()
    session.refresh(report)
    return {"share_id": report.id, "url": f"/share/{report.id}", "expires_in_days": SHARE_TTL_DAYS}


@router.get("/share/{share_id}")
def get_shared_report(share_id: str, session: Session = Depends(get_session)) -> dict:
    report = session.get(SharedReport, share_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    if report.created_at < datetime.utcnow() - timedelta(days=SHARE_TTL_DAYS):
        session.delete(report)
        session.commit()
        raise HTTPException(status_code=404, detail="Report not found")
    return {
        "id": report.id,
        "kind": report.kind,
        "data": json.loads(report.data_json),
        "created_at": report.created_at.isoformat(),
        "expires_in_days": SHARE_TTL_DAYS,
    }


@router.get("/{result_id}", response_model=CheckTextResponse)
def get_result(result_id: str, session: Session = Depends(get_session)) -> dict:
    record = session.get(CheckResult, result_id)
    if not record:
        raise HTTPException(status_code=404, detail="Result not found")
    if record.created_at < datetime.utcnow() - timedelta(hours=RESULT_TTL_HOURS):
        session.delete(record)
        session.commit()
        raise HTTPException(status_code=404, detail="Result not found")
    return json.loads(record.data_json)
