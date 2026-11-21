# !bot_SQL — лабораторный бот (Postgres)

Отдельно от **`bot/`** (прод + Google Sheets + VPS).

| | `bot/` | `!bot_SQL/` |
|---|--------|-------------|
| Запуск | `python main.py` | `python main_sql.py` |
| Env | `.env` | `.env.sql` |
| Данные | Sheets | Postgres |

Общие модули (flows, keyboards, charts): из `../bot/`. Свои: `sql_config.py`, `sql_store.py` (не `config` — конфликт с `bot/config.py`).

**Инструкция:** `SQL_BOT_SETUP.md`  
**План SQL:** `../Goal_Move_To_SQL.md`

```bash
cd '!bot_SQL'
source ../bot/.venv/bin/activate
python main_sql.py
```

**Цели месяца** (`month_goals`): при `prepare_day` — routine (28/30/31 дн.) + sport (шаблон 2026).  
Дозаполнить старые месяцы: `python backfill_month_goals.py`  
Проверка в TablePlus: `../db/check_month_goals.sql`

**Дашборд SQL:** `../index-sql.html` + API `../api/` (см. `../api/README.md`).

## Режимы DATA_STORE

- `postgres` — SQL-бот пишет напрямую в Postgres.
- `http` — SQL-бот пишет через FastAPI (`API_BASE_URL`, endpoint `/write`).
- `sheets` — старый путь через Apps Script (для сверки/сравнения).
