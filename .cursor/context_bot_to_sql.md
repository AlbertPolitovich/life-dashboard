# SQL / API / SQL-бот — сжатый контекст

> Чаты про **Mini App UI**: **`@.cursor/context_bot_miniapp.md`** (главная правда продукта).  
> Этот файл — Postgres, FastAPI, SQL-бот.

**Прод Mini App (ежедневно):** Postgres + API + `mini-app/` на **Selectel** (`dash.svodbot.ru`).  
**SQL-бот `!bot_SQL/`:** запасной fill / лаборатория (не путать с legacy Sheets).  
**Legacy (не для ежедневной работы):** `bot/` + Google Sheets + корневой `index.html` + Apps Script — см. `context_bot_appscript.md` / `context_html_appscript.md`.

---

## Статус

- [x] Postgres (`docker-compose`, `db/schema.sql` + `db/migrations/001`…`031`)
- [x] FastAPI чтение + запись (`api/`, порт **8765**)
- [x] Mini App в проде — см. `context_bot_miniapp.md`
- [x] SQL-бот пишет день (routine + sport), цели месяца
- [x] `index-sql.html` (локальный дашборд с `:8765`)

**Не делаем без запроса:** воскресные PNG в SQL-боте · поднимать legacy Sheets · dual API на Amsterdam.

---

## Схема БД (кратко, ядро)

```text
months → days → routine_values (sphere 2–9, 0/1)
              → sport_values (field 10–22, текст)
months → month_goals (kind=goal, target_key, value)
diary_entries (entry_date PK, body text) — без FK на days
+ nutrition_* / finance_* / ledger_* — см. db/migrations/
```

Цели routine: 28/30/31 дней в месяце (`routine_month_goals.py`).  
Цели sport 2026: поля 10,11,14,15,16,19,20 (`sport_month_goals.py`).  
Дозаполнить старые месяцы: `python backfill_month_goals.py` в `!bot_SQL/`.

Локальный docker-юзер: `life`/`life`. Прод: `lifeapp` (не путать в командах).

---

## API (`api/`, порт 8765)

| Метод | Путь | Назначение |
|-------|------|------------|
| GET | `/health` | жив ли сервис |
| GET | `/month?month=YYYY-MM` | прогресс месяца |
| GET | `/week?date=&month=` | продуктивность пн–вс |
| GET | `/day?date=YYYY-MM-DD` | что уже заполнено за день |
| GET/POST/DELETE | `/diary/*` | дневник (+ `suggest-tokens`) |
| * | `/nutrition/*` · `/finance/*` · `/ledger/*` | модули Mini App |
| POST | `/write` | `prepareDay`, `writeRoutineBatch`, `writeSportBatch` |

Запуск API: `cd api && ./run.sh`  
Mini App: **http://127.0.0.1:8765/mini-app/**

SQL-бот через API (опционально в `.env.sql`):

```env
DATA_STORE=http
API_BASE_URL=http://127.0.0.1:8765
```

Иначе по умолчанию `DATA_STORE=postgres` — бот пишет в БД напрямую.

---

## Запуск на Mac

```bash
docker compose up -d                    # Postgres
cd api && ./run.sh                      # API
cd '!bot_SQL' && python main_sql.py     # SQL-бот (отдельный токен)
```

Env: `!bot_SQL/.env.sql` (см. `!bot_SQL/SQL_BOT_SETUP.md`). Секреты в чат не выводить.

---

## Проверка дня в TablePlus

```sql
SELECT r.sphere, r.value FROM routine_values r
JOIN days d ON d.id = r.day_id WHERE d.day_date = '2026-06-03';

SELECT s.field, s.value FROM sport_values s
JOIN days d ON d.id = s.day_id WHERE d.day_date = '2026-06-03'
ORDER BY s.field::int;
```

---

## Файлы

| Путь | Роль |
|------|------|
| `!bot_SQL/postgres_store.py` | запись в Postgres |
| `!bot_SQL/http_store.py` | запись через API |
| `api/server.py`, `month_read.py`, `day_read.py` | FastAPI |
| `index-sql.html` | веб-дашборд SQL (лок.) |
| `mini-app/` | прод UI |

Исторический roadmap: `@Goal_Move_To_SQL.md` (устарел как план — путь B/API уже в проде).
