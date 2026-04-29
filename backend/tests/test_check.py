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


def test_urls_and_registered_names_are_not_flagged() -> None:
    response = client.post(
        "/api/v1/check/text",
        json={"text": "Кейс Adbeam: https://adbeam.ru и рост продаж", "context_type": "реклама", "use_llm": False},
    )
    assert response.status_code == 200
    data = response.json()
    terms = {issue["term"].lower() for issue in data["issues"]}
    assert "https" not in terms
    assert "adbeam" not in terms
    assert "ru" not in terms


def test_user_excluded_phrase_is_not_flagged() -> None:
    response = client.post(
        "/api/v1/check/text",
        json={
            "text": "Grand Line sale",
            "context_type": "СЂРµРєР»Р°РјР°",
            "use_llm": False,
            "excluded_terms": ["Grand Line"],
        },
    )
    assert response.status_code == 200
    data = response.json()
    terms = {issue["term"].lower() for issue in data["issues"]}
    assert "grand" not in terms
    assert "line" not in terms
    assert "sale" in terms
