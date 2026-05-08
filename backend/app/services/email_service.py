import logging
import os
import smtplib
from datetime import datetime
from email.message import EmailMessage
from email.utils import formataddr


logger = logging.getLogger(__name__)


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _smtp_from() -> str:
    configured = os.getenv("SMTP_FROM", "").strip()
    if configured:
        return configured
    user = os.getenv("SMTP_USER", "").strip() or os.getenv("SUPPORT_EMAIL", "").strip()
    return formataddr(("СтопСлово", user)) if user else "СтопСлово"


def email_enabled() -> bool:
    return _env_bool("EMAIL_ENABLED", False)


def send_email(to_email: str, subject: str, text: str, html: str | None = None) -> bool:
    if not email_enabled():
        logger.info("email disabled; skipped message to %s with subject %r", to_email, subject)
        return False

    host = os.getenv("SMTP_HOST", "").strip()
    port = int(os.getenv("SMTP_PORT", "465"))
    username = os.getenv("SMTP_USER", "").strip()
    password = os.getenv("SMTP_PASSWORD", "")
    use_ssl = _env_bool("SMTP_SSL", True)
    use_tls = _env_bool("SMTP_TLS", False)

    if not host or not username or not password:
        logger.warning("email enabled but SMTP_HOST/SMTP_USER/SMTP_PASSWORD is incomplete")
        return False

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = _smtp_from()
    message["To"] = to_email
    message.set_content(text)
    if html:
        message.add_alternative(html, subtype="html")

    try:
        if use_ssl:
            with smtplib.SMTP_SSL(host, port, timeout=15) as smtp:
                smtp.login(username, password)
                smtp.send_message(message)
        else:
            with smtplib.SMTP(host, port, timeout=15) as smtp:
                if use_tls:
                    smtp.starttls()
                smtp.login(username, password)
                smtp.send_message(message)
    except Exception:
        logger.exception("failed to send email to %s", to_email)
        return False

    logger.info("sent email to %s with subject %r", to_email, subject)
    return True


def send_welcome_email(to_email: str) -> bool:
    frontend_url = os.getenv("FRONTEND_URL", "https://stopslovo.dev-cloud-ksa.ru").rstrip("/")
    support_email = os.getenv("SUPPORT_EMAIL", "stopslovo_supp@inbox.ru")
    subject = "Добро пожаловать в СтопСлово"
    text = (
        "Здравствуйте!\n\n"
        "Вы зарегистрировались в сервисе СтопСлово.\n\n"
        "Что можно делать:\n"
        "- проверять рекламные тексты на потенциально спорные иностранные слова и заимствования;\n"
        "- загружать CSV/XLSX из рекламного кабинета;\n"
        "- выбирать варианты замен и скачивать файл для обратной загрузки;\n"
        "- создавать публичную ссылку на отчёт.\n\n"
        "На бесплатном тарифе доступны 1 800 слов, 200 строк файлов и 5 ИИ-уточнений в месяц.\n\n"
        f"Открыть сервис: {frontend_url}\n"
        f"Поддержка: {support_email}\n\n"
        "Это автоматическая оценка риска, не юридическое заключение."
    )
    html = f"""
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2a37">
      <h2>Добро пожаловать в СтопСлово</h2>
      <p>Вы зарегистрировались в сервисе проверки рекламных текстов.</p>
      <p><strong>Что можно делать:</strong></p>
      <ul>
        <li>проверять рекламные тексты на потенциально спорные иностранные слова и заимствования;</li>
        <li>загружать CSV/XLSX из рекламного кабинета;</li>
        <li>выбирать варианты замен и скачивать файл для обратной загрузки;</li>
        <li>создавать публичную ссылку на отчёт.</li>
      </ul>
      <p>На бесплатном тарифе доступны <strong>1 800 слов</strong>, <strong>200 строк файлов</strong> и <strong>5 ИИ-уточнений</strong> в месяц.</p>
      <p><a href="{frontend_url}" style="color:#4a7c10;font-weight:bold">Открыть СтопСлово</a></p>
      <p>Поддержка: <a href="mailto:{support_email}">{support_email}</a></p>
      <p style="font-size:12px;color:#667085">Это автоматическая оценка риска, не юридическое заключение.</p>
    </div>
    """
    return send_email(to_email, subject, text, html)


PLAN_NAMES = {
    "free": "Бесплатный",
    "freelancer": "Фрилансер",
    "agency_s": "Команда",
    "agency_m": "Агентство",
    "one_time": "Разовая проверка",
}

PLAN_LIMITS_TEXT = {
    "free": "1 800 слов, 200 строк файлов и 5 ИИ-уточнений в месяц",
    "freelancer": "10 000 слов, 5 000 строк файлов и ИИ-анализ без ограничений",
    "agency_s": "120 000 слов, 50 000 строк файлов и ИИ-анализ без ограничений",
    "agency_m": "без лимита слов, строк файлов и ИИ-анализа",
    "one_time": "1 файл до 2 000 строк или текст до 5 000 слов, ИИ-анализ без ограничений",
}


def _format_dt(value: datetime | None) -> str:
    if not value:
        return "без срока окончания"
    return value.strftime("%H:%M:%S %d.%m.%Y")


def send_plan_activated_email(to_email: str, plan: str, expires_at: datetime | None = None) -> bool:
    plan_name = PLAN_NAMES.get(plan, plan)
    limits = PLAN_LIMITS_TEXT.get(plan, "")
    frontend_url = os.getenv("FRONTEND_URL", "https://stopslovo.dev-cloud-ksa.ru").rstrip("/")
    support_email = os.getenv("SUPPORT_EMAIL", "stopslovo_supp@inbox.ru")
    subject = f"Тариф «{plan_name}» активирован"
    expires_text = _format_dt(expires_at)
    text = (
        f"Здравствуйте!\n\n"
        f"Ваш тариф «{plan_name}» активирован.\n"
        f"Действует до: {expires_text}.\n"
        f"Лимиты тарифа: {limits}.\n\n"
        f"Открыть сервис: {frontend_url}\n"
        f"Поддержка: {support_email}\n\n"
        "Это автоматическое уведомление СтопСлово."
    )
    html = f"""
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2a37">
      <h2>Тариф «{plan_name}» активирован</h2>
      <p>Ваш тариф успешно активирован.</p>
      <p><strong>Действует до:</strong> {expires_text}</p>
      <p><strong>Лимиты тарифа:</strong> {limits}</p>
      <p><a href="{frontend_url}" style="color:#4a7c10;font-weight:bold">Открыть СтопСлово</a></p>
      <p>Поддержка: <a href="mailto:{support_email}">{support_email}</a></p>
    </div>
    """
    return send_email(to_email, subject, text, html)


def send_share_report_email(to_email: str, share_url: str, kind: str, expires_in_days: int) -> bool:
    report_type = "файлу" if kind == "batch" else "тексту"
    support_email = os.getenv("SUPPORT_EMAIL", "stopslovo_supp@inbox.ru")
    subject = "Ссылка на отчёт СтопСлово"
    text = (
        f"Здравствуйте!\n\n"
        f"Вы создали публичную ссылку на отчёт по {report_type}.\n\n"
        f"Ссылка: {share_url}\n"
        f"Срок действия: {expires_in_days} дней.\n\n"
        "По ссылке отчёт открывается без входа в аккаунт. Пересылайте её только тем, кому можно показать результаты проверки.\n\n"
        f"Поддержка: {support_email}"
    )
    html = f"""
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2a37">
      <h2>Ссылка на отчёт готова</h2>
      <p>Вы создали публичную ссылку на отчёт по {report_type}.</p>
      <p><a href="{share_url}" style="color:#4a7c10;font-weight:bold">Открыть отчёт</a></p>
      <p>Срок действия: {expires_in_days} дней.</p>
      <p style="font-size:12px;color:#667085">По ссылке отчёт открывается без входа в аккаунт. Пересылайте её только тем, кому можно показать результаты проверки.</p>
      <p>Поддержка: <a href="mailto:{support_email}">{support_email}</a></p>
    </div>
    """
    return send_email(to_email, subject, text, html)


def send_limit_exceeded_email(to_email: str, limit_name: str, plan: str) -> bool:
    plan_name = PLAN_NAMES.get(plan, plan)
    frontend_url = os.getenv("FRONTEND_URL", "https://stopslovo.dev-cloud-ksa.ru").rstrip("/")
    pricing_url = f"{frontend_url}/pricing"
    support_email = os.getenv("SUPPORT_EMAIL", "stopslovo_supp@inbox.ru")
    subject = "Лимит СтопСлово исчерпан"
    text = (
        "Здравствуйте!\n\n"
        f"На тарифе «{plan_name}» исчерпан лимит: {limit_name}.\n"
        "Чтобы продолжить проверку, можно дождаться обновления лимитов или выбрать другой тариф.\n\n"
        f"Тарифы: {pricing_url}\n"
        f"Поддержка: {support_email}"
    )
    html = f"""
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2a37">
      <h2>Лимит исчерпан</h2>
      <p>На тарифе «{plan_name}» исчерпан лимит: <strong>{limit_name}</strong>.</p>
      <p>Чтобы продолжить проверку, можно дождаться обновления лимитов или выбрать другой тариф.</p>
      <p><a href="{pricing_url}" style="color:#4a7c10;font-weight:bold">Смотреть тарифы</a></p>
      <p>Поддержка: <a href="mailto:{support_email}">{support_email}</a></p>
    </div>
    """
    return send_email(to_email, subject, text, html)


def send_subscription_reminder_email(to_email: str, plan: str, expires_at: datetime, days_left: int) -> bool:
    plan_name = PLAN_NAMES.get(plan, plan)
    frontend_url = os.getenv("FRONTEND_URL", "https://stopslovo.dev-cloud-ksa.ru").rstrip("/")
    pricing_url = f"{frontend_url}/pricing"
    support_email = os.getenv("SUPPORT_EMAIL", "stopslovo_supp@inbox.ru")
    expires_text = _format_dt(expires_at)
    day_word = "день" if days_left == 1 else "дня" if 2 <= days_left <= 4 else "дней"
    subject = f"Тариф «{plan_name}» заканчивается через {days_left} {day_word}"
    text = (
        "Здравствуйте!\n\n"
        f"Ваш тариф «{plan_name}» действует до {expires_text}.\n"
        f"До окончания осталось {days_left} {day_word}.\n\n"
        "Чтобы проверка рекламных текстов не прерывалась, продлите доступ заранее.\n\n"
        f"Продлить доступ: {pricing_url}\n"
        f"Поддержка: {support_email}\n\n"
        "Если вы уже продлили тариф, это письмо можно проигнорировать."
    )
    html = f"""
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2a37">
      <h2>Тариф «{plan_name}» скоро закончится</h2>
      <p>Ваш тариф действует до <strong>{expires_text}</strong>.</p>
      <p>До окончания осталось <strong>{days_left} {day_word}</strong>.</p>
      <p>Чтобы проверка рекламных текстов не прерывалась, продлите доступ заранее.</p>
      <p><a href="{pricing_url}" style="color:#4a7c10;font-weight:bold">Продлить доступ</a></p>
      <p>Поддержка: <a href="mailto:{support_email}">{support_email}</a></p>
      <p style="font-size:12px;color:#667085">Если вы уже продлили тариф, это письмо можно проигнорировать.</p>
    </div>
    """
    return send_email(to_email, subject, text, html)


def send_test_email(to_email: str) -> bool:
    frontend_url = os.getenv("FRONTEND_URL", "https://stopslovo.dev-cloud-ksa.ru").rstrip("/")
    return send_email(
        to_email,
        "Тестовое письмо СтопСлово",
        f"SMTP-уведомления СтопСлово работают.\n\nСервис: {frontend_url}",
        f"""
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2a37">
          <h2>SMTP-уведомления работают</h2>
          <p>Это тестовое письмо СтопСлово.</p>
          <p><a href="{frontend_url}" style="color:#4a7c10;font-weight:bold">Открыть сервис</a></p>
        </div>
        """,
    )
