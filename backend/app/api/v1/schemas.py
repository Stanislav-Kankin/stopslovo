from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


ContextType = Literal[
    "реклама",
    "карточка_товара",
    "баннер",
    "упаковка",
    "сайт",
    "презентация",
    "b2b_документ",
]
RiskLevel = Literal["high", "medium", "low", "safe"]


class CheckTextRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=20_000)
    context_type: ContextType = "реклама"
    request_id: str | None = None
    use_llm: bool = False
    excluded_terms: list[str] = Field(default_factory=list, max_length=200)


class CheckBatchRequest(BaseModel):
    items: list[CheckTextRequest] = Field(..., min_length=1, max_length=100)


class Issue(BaseModel):
    term: str
    normalized: str
    category: Literal["latin", "cyrillic_borrowing", "missed_by_dictionary"]
    risk: RiskLevel
    reason: str
    replacements: list[str]
    sources: list[str] = Field(default_factory=list)
    keep_as_is: bool
    ai_refined: bool = False
    ai_summary: str | None = None


class CheckTextResponse(BaseModel):
    request_id: str
    original_text: str
    overall_risk: RiskLevel
    issues: list[Issue]
    rewritten_text: str
    summary: str
    manual_review_required: bool
    manual_review_reason: str | None
    processed_at: datetime


class CheckBatchResponse(BaseModel):
    items: list[CheckTextResponse]


class RefineIssueRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=20_000)
    context_type: ContextType = "реклама"
    issue: Issue


class RefineIssueResponse(BaseModel):
    issue: Issue
    summary: str
    llm_explanation: str
    rewritten_text: str
    manual_review_required: bool
    manual_review_reason: str | None
