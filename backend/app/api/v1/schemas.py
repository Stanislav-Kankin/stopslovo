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
    context_type: ContextType
    request_id: str | None = None


class CheckBatchRequest(BaseModel):
    items: list[CheckTextRequest] = Field(..., min_length=1, max_length=100)


class Issue(BaseModel):
    term: str
    normalized: str
    category: Literal["latin", "cyrillic_borrowing", "missed_by_dictionary"]
    risk: RiskLevel
    reason: str
    replacements: list[str]
    keep_as_is: bool


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
