# Деплой на dev-cloud-ksa.ru

## DNS

В панели DNS замените старые A-записи на IP нового VPS:

```text
@    A    185.184.78.20
www  A    185.184.78.20
```

Сейчас на скриншоте домен указывает на `94.141.161.148`, поэтому перед запуском HTTPS надо дождаться обновления DNS.

Проверка на сервере или локально:

```bash
dig +short dev-cloud-ksa.ru
dig +short www.dev-cloud-ksa.ru
```

Обе команды должны вернуть `185.184.78.20`.

## Запуск на VPS

```bash
cd ~/stopslovo
git pull
cp .env.production.example .env
nano .env
```

Минимальный `.env`:

```env
DEEPSEEK_API_KEY=your_deepseek_key
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com

SERVER_NAME=dev-cloud-ksa.ru
HTTP_PORT=80
HTTPS_PORT=443
SSL_CERT_PATH=/etc/letsencrypt/live/dev-cloud-ksa.ru/fullchain.pem
SSL_KEY_PATH=/etc/letsencrypt/live/dev-cloud-ksa.ru/privkey.pem
```

Запуск:

```bash
docker compose up -d --build
docker compose ps
```

Проверка:

```bash
curl -I https://dev-cloud-ksa.ru/healthz
curl https://dev-cloud-ksa.ru/health
```

Логи:

```bash
docker compose logs -f backend
docker compose logs -f frontend
```

Обновление:

```bash
cd ~/stopslovo
git pull
docker compose up -d --build
```
