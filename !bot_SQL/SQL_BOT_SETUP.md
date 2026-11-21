# Routine/Sport SQL — лаборатория (`!bot_SQL/`)

Прод-бот: папка **`bot/`** — `main.py` + `.env` (+ VPS).  
SQL-бот: папка **`!bot_SQL/`** — `main_sql.py` + `.env.sql`, **другой токен**.

План: `../Goal_Move_To_SQL.md`.

---

## Шаг 1 — BotFather: новый бот

1. Telegram → [@BotFather](https://t.me/BotFather).
2. `/newbot`
3. Имя: **Life Dashboard SQL test**
4. Username: `life_dashboard_sql_bot` (свой уникальный)
5. Скопируй **токен** → `BOT_TOKEN` в `.env.sql`.

**Прод-бот не трогай** — токен в `bot/.env`.

---

## Шаг 2 — `.env.sql`

```bash
cd /Users/artem/Desktop/life-dashboard/\!bot_SQL
cp .env.sql.example .env.sql
```

Вставь новый `BOT_TOKEN`.

---

## Шаг 3 — Структура

| `!bot_SQL/` | Назначение |
|-------------|------------|
| `main_sql.py` | Запуск SQL-бота |
| `sql_config.py` | `.env.sql` |
| `sql_store.py` | postgres / sheets |
| `postgres_store.py` | Заглушка → SQL |
| `_bootstrap.py` | Подключает `../bot/` (flows, charts) |

Дублировать `routine_flow.py` **не нужно**.

---

## Шаг 4 — Запуск

```bash
cd /Users/artem/Desktop/life-dashboard/\!bot_SQL
source ../bot/.venv/bin/activate
python main_sql.py
```

SQL-бот (другой токен) можно параллельно с **прод на VPS**.

---

## Шаг 5 — Два бота

| | Прод `bot/` | SQL `!bot_SQL/` |
|---|-------------|-----------------|
| Запуск | `python main_sql.py` | `python main_sql.py` |
| Env | `.env` | `.env.sql` |
| Данные | Sheets | Postgres (позже) |
| 🔔 | Да | Нет |

---

## Шаг 6 — Дальше

`docker-compose` + `db/schema.sql` + код в `postgres_store.py`.

---

## Git

Не коммитить: `.env.sql` (в корневом `.gitignore`).
