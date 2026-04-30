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
        json={"text": "Big sale и кешбэк для клиентов", "context_type": "реклама", "use_llm": False},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["overall_risk"] == "high"
    assert data["manual_review_required"] is True
    terms = {issue["normalized"] for issue in data["issues"]}
    assert "sale" in terms
    assert "кешбэк" in terms
    sale_issue = next(issue for issue in data["issues"] if issue["normalized"] == "sale")
    assert sale_issue["sources"]
    assert "Это автоматическая оценка риска, не юридическое заключение." in data["summary"]


def test_context_type_is_optional() -> None:
    response = client.post(
        "/api/v1/check/text",
        json={"text": "sale", "use_llm": False},
    )
    assert response.status_code == 200
    assert response.json()["overall_risk"] == "high"


def test_clean_text_is_safe() -> None:
    response = client.post(
        "/api/v1/check/text",
        json={"text": "Скидки на товары для дома", "context_type": "сайт", "use_llm": False},
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
            "context_type": "реклама",
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


def test_repeated_terms_are_reported_once_per_text() -> None:
    response = client.post(
        "/api/v1/check/text",
        json={
            "text": "Grand Line Grand Line sale sale",
            "context_type": "реклама",
            "use_llm": False,
        },
    )
    assert response.status_code == 200
    terms = [issue["normalized"] for issue in response.json()["issues"]]
    assert terms.count("grand") == 1
    assert terms.count("line") == 1
    assert terms.count("sale") == 1


def test_russian_compressed_compounds_are_not_flagged_as_borrowings() -> None:
    response = client.post(
        "/api/v1/check/text",
        json={
            "text": "Доппродажи и спеццены для постоянных клиентов",
            "context_type": "реклама",
            "use_llm": False,
        },
    )
    assert response.status_code == 200
    terms = {issue["term"].lower() for issue in response.json()["issues"]}
    assert "доппродажи" not in terms
    assert "спеццены" not in terms


def test_cyrillic_abbreviations_and_russian_derivatives_are_not_flagged() -> None:
    response = client.post(
        "/api/v1/check/text",
        json={
            "text": "РСЯ помогает масштабироваться в рекламе",
            "context_type": "реклама",
            "use_llm": False,
        },
    )
    assert response.status_code == 200
    terms = {issue["term"].lower() for issue in response.json()["issues"]}
    assert "рся" not in terms
    assert "масштабироваться" not in terms
