import logging
import os
import smtplib
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
