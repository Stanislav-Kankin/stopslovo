# Деплой на stopslovo.dev-cloud-ksa.ru

## DNS

Корневой домен `dev-cloud-ksa.ru` и `www.dev-cloud-ksa.ru` не трогаем, потому что там уже работает другой проект.

В DNS-зоне добавьте новую A-запись:

```text
stopslovo    A    185.184.78.20
```

Проверка после обновления DNS:

```bash
dig +short stopslovo.dev-cloud-ksa.ru
```

Команда должна вернуть:

```text
185.184.78.20
```

## SSL

Если у вас уже есть wildcard-сертификат `*.dev-cloud-ksa.ru`, можно указать его реальные пути в `.env`.

Если сертификата для поддомена еще нет, после обновления DNS выпустите его на VPS:

```bash
apt update
apt install -y certbot
certbot certonly --standalone -d stopslovo.dev-cloud-ksa.ru
```

На время выпуска сертификата порт `80` должен быть свободен. Если Docker уже запущен и занял порт, остановите его:

```bash
docker compose down
```

Стандартные пути Let's Encrypt:

```text
/etc/letsencrypt/live/stopslovo.dev-cloud-ksa.ru/fullchain.pem
/etc/letsencrypt/live/stopslovo.dev-cloud-ksa.ru/privkey.pem
```

## .env на VPS

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

SERVER_NAME=stopslovo.dev-cloud-ksa.ru
HTTP_PORT=80
HTTPS_PORT=443
SSL_CERT_PATH=/etc/letsencrypt/live/stopslovo.dev-cloud-ksa.ru/fullchain.pem
SSL_KEY_PATH=/etc/letsencrypt/live/stopslovo.dev-cloud-ksa.ru/privkey.pem
```

## Запуск

```bash
docker compose up -d --build
docker compose ps
```

Проверка:

```bash
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
cd ~/stopslovo
git pull
docker compose up -d --build
```
