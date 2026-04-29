# StopSlovo

Веб-сервис на FastAPI + React для автоматической оценки рекламных и потребительских текстов на иностранные слова и англицизмы. Сервис не выдает юридическое заключение и всегда показывает дисклеймер: "Это автоматическая оценка риска, не юридическое заключение".

## Возможности

- Проверка одного текста: `POST /api/v1/check/text`
- Batch-проверка: `POST /api/v1/check/batch`
- Получение результата: `GET /api/v1/check/{id}`
- Healthcheck: `GET /health`
- Локальный словарь на 150+ записей
- Контекстная корректировка риска
- DeepSeek `deepseek-chat` при наличии `DEEPSEEK_API_KEY`
- Локальный fallback без LLM для тестов и демо
- React-интерфейс с темной темой, CSV batch и экспортом

## Локальный запуск без Docker

Backend:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item ..\.env.example ..\.env
uvicorn app.main:app --reload
```

Frontend:

```powershell
cd frontend
npm install
npm run dev
```

Адреса: backend `http://127.0.0.1:8000`, frontend `http://127.0.0.1:5173`.

## Локальный запуск в Docker

Этот режим не требует SSL-сертификатов:

```powershell
Copy-Item .env.example .env
docker compose -f docker-compose.local.yml up --build
```

Адреса: frontend `http://127.0.0.1:5173`, backend `http://127.0.0.1:8000`.

## Production на VPS

1. Скопируйте проект на сервер.
2. Создайте `.env` из шаблона:

```bash
cp .env.production.example .env
```

3. Заполните значения:

```env
DEEPSEEK_API_KEY=...
SERVER_NAME=stopslovo.dev-cloud-ksa.ru
SSL_CERT_PATH=/etc/letsencrypt/live/stopslovo.dev-cloud-ksa.ru/fullchain.pem
SSL_KEY_PATH=/etc/letsencrypt/live/stopslovo.dev-cloud-ksa.ru/privkey.pem
```

4. Проверьте, что DNS домена указывает на VPS, а порты `80` и `443` открыты.

Если основной домен уже занят другим проектом, используйте отдельный поддомен. Для текущего VPS нужна A-запись:

```text
stopslovo    A    185.184.78.20
```

Корневой домен `dev-cloud-ksa.ru` и `www.dev-cloud-ksa.ru` можно оставить на старом IP.
5. Запустите:

```bash
docker compose up -d --build
```

Production compose поднимает:

- `backend` - FastAPI внутри сети Docker на `8000`
- `frontend` - nginx, который отдает React-статику, редиректит HTTP на HTTPS и проксирует `/api/` в backend

Проверка:

```bash
docker compose ps
curl -I https://stopslovo.dev-cloud-ksa.ru/healthz
curl https://stopslovo.dev-cloud-ksa.ru/health
```

Логи:

```bash
docker compose logs -f backend
docker compose logs -f frontend
```

Обновление:

```bash
git pull
docker compose up -d --build
```

## Excel/CSV для batch-режима

Batch-режим принимает `.xlsx`, `.xls` и `.csv`. Можно загружать выгрузку из рекламного кабинета как есть: сервис сам попробует найти и объединить текстовые колонки.

Для больших файлов batch работает в быстром словарном режиме без LLM, чтобы обработка занимала минуты, а не часы, и не сжигала бюджет API. Для детального контекстного разбора через DeepSeek используйте проверку одного текста.

Результаты лучше экспортировать в `XLSX`: это нативный формат Excel и он не ломает кириллицу. CSV-экспорт оставлен как запасной вариант для систем, которые ожидают именно текстовый файл.

Автоматически используются колонки, в названии которых есть:

```text
заголовок, подзаголовок, описание, текст, быстрые ссылки, уточнения, headline, description, title
```

Статистические и технические поля вроде `url`, `utm`, `показы`, `клики`, `ставка`, `бюджет` игнорируются. Если в файле есть колонка `context_type`, она будет использована; если нет, строки считаются рекламой.

Идеальный CSV-формат для ручной подготовки:

```csv
id,text,context_type
ad-1,"Big sale и кешбэк только сегодня",реклама
site-1,"Скидки на товары для дома",сайт
```

Допустимые `context_type`: `реклама`, `карточка_товара`, `баннер`, `упаковка`, `сайт`, `презентация`, `b2b_документ`.

## API пример

```bash
curl -X POST "https://stopslovo.dev-cloud-ksa.ru/api/v1/check/text" \
  -H "Content-Type: application/json" \
  -d '{"text":"Big sale и кешбэк на premium товары","context_type":"реклама"}'
```

## Тесты

```powershell
cd backend
pytest
```

## Обогащение словаря

Основной словарь лежит в `backend/app/data/dictionary.json`. Его можно пополнять вручную, но лучше использовать CLI-помощник, чтобы не сломать структуру JSON и не добавить дубль.

Проверить словарь:

```bash
cd backend
python tools/dictionary_tool.py validate
```

Добавить латинское слово:

```bash
python tools/dictionary_tool.py add \
  --term dropshipping \
  --script latin \
  --category retail \
  --risk medium \
  --replacement "прямая поставка" \
  --replacement "продажа со склада поставщика"
```

Добавить кириллическое заимствование:

```bash
python tools/dictionary_tool.py add \
  --term "реферальный" \
  --script cyrillic_borrowing \
  --category marketing \
  --risk medium \
  --replacement "по рекомендации" \
  --replacement "партнерский"
```

Практический процесс такой: смотрите слова, которые часто попадают в категорию `missed_by_dictionary`, вручную решаете, это бренд/норма/риск, затем добавляете устойчивые случаи в словарь. Для полностью освоенных слов ставьте `risk_base: safe`, чтобы сервис перестал их флагать.

## Переменные окружения

- `DEEPSEEK_API_KEY` - ключ DeepSeek API. Если не задан, используется локальная проверка.
- `DEEPSEEK_MODEL` - модель DeepSeek, по умолчанию `deepseek-chat`.
- `DEEPSEEK_BASE_URL` - базовый URL API, по умолчанию `https://api.deepseek.com`.
- `SERVER_NAME` - домен для nginx.
- `SSL_CERT_PATH` и `SSL_KEY_PATH` - пути к SSL-сертификату и приватному ключу на VPS.

## Важное ограничение

Сервис помогает выявлять рискованные формулировки, но не должен использоваться как единственный источник решения. Это автоматическая оценка риска, не юридическое заключение.
