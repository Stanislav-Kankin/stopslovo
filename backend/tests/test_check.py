from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_check_text_flags_high_risk_ad() -> None:
    response = client.post(
        "/api/v1/check/text",
        json={"text": "Big sale и кешбэк для клиентов", "context_type": "реклама"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["overall_risk"] == "high"
    assert data["manual_review_required"] is True
    terms = {issue["normalized"] for issue in data["issues"]}
    assert "sale" in terms
    assert "кешбэк" in terms
    assert "Это автоматическая оценка риска, не юридическое заключение." in data["summary"]


def test_clean_text_is_safe() -> None:
    response = client.post(
        "/api/v1/check/text",
        json={"text": "Скидки на товары для дома", "context_type": "сайт"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["overall_risk"] == "safe"
    assert data["issues"] == []
    assert data["rewritten_text"] == "Скидки на товары для дома"
