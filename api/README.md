# API для index-sql.html

FastAPI для дашборда, SQL-бота и Mini App.

| Метод | Путь | Зачем |
|-------|------|--------|
| GET | `/health` | API жив |
| GET | `/month?month=YYYY-MM` | Прогресс месяца (верх экрана Mini App / index-sql) |
| GET | `/week?date=YYYY-MM-DD&month=YYYY-MM` | Продуктивность за пн–вс (цель = доля месячной) |
| GET | `/day?date=YYYY-MM-DD` | Уже заполнено за день (форма Mini App) |
| POST | `/write` | Запись: `prepareDay`, `writeRoutineBatch`, `writeSportBatch` |

## Запуск

```bash
cd /Users/artem/Desktop/life-dashboard
docker compose up -d

cd api
source ../bot/.venv/bin/activate
pip install -r requirements.txt
# опционально: cp .env.example .env

./run.sh
# или вручную (обязательно из папки api/):
# uvicorn server:app --host 127.0.0.1 --port 8765 --reload
```

## Проверка

```bash
curl -s "http://127.0.0.1:8765/month?month=2026-05" | python3 -m json.tool | head -40
curl -s "http://127.0.0.1:8765/day?date=2026-06-03" | python3 -m json.tool
curl -s "http://127.0.0.1:8765/health"
curl -s -X POST "http://127.0.0.1:8765/write" \
  -H "Content-Type: application/json" \
  -d '{"action":"prepareDay","date":"2026-06-02"}'
```

Открыть в браузере (рекомендуется, один origin с API):

**http://127.0.0.1:8765/** или **http://127.0.0.1:8765/index-sql.html**

Mini App (тот же origin, без CORS):

**http://127.0.0.1:8765/mini-app/**

Контекст и handoff для агента: **`.cursor/context_bot_miniapp.md`**, **`.cursor/prompt-mini-app-continue.md`**

Альтернатива: `python3 -m http.server 8080` в корне → `http://127.0.0.1:8080/index-sql.html` (нужен запущенный API на 8765).

## SQL-бот через API (`DATA_STORE=http`)

В `!bot_SQL/.env.sql`:

```env
DATA_STORE=http
API_BASE_URL=http://127.0.0.1:8765
```

После этого SQL-бот пишет не напрямую в Postgres, а через `POST /write`.
