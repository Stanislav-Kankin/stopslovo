from datetime import datetime, timezone
from uuid import uuid4


class ReportGenerator:
    def build(self, original_text: str, request_id: str | None, analysis: dict) -> dict:
        return {
            "request_id": request_id or str(uuid4()),
            "original_text": original_text,
            "overall_risk": analysis["overall_risk"],
            "issues": analysis["issues"],
            "rewritten_text": analysis["rewritten_text"],
            "summary": analysis["summary"],
            "manual_review_required": analysis["manual_review_required"],
            "manual_review_reason": analysis.get("manual_review_reason"),
            "processed_at": datetime.now(timezone.utc),
        }
