"""
Дозаполнить month_goals для всех месяцев, уже есть в таблице months.
Запуск из !bot_SQL/:
  source ../bot/.venv/bin/activate
  python backfill_month_goals.py
"""

from __future__ import annotations

import asyncio
from datetime import date

import _bootstrap  # noqa: F401

from sql_config import load_sql_config
from postgres_store import PostgresStore


async def main() -> None:
    config = load_sql_config()
    if not config.database_url:
        raise SystemExit("Нет DATABASE_URL в .env.sql")

    store = PostgresStore(config.database_url)
    pool = await store._get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT year_month FROM months ORDER BY year_month")

    for row in rows:
        ym = str(row["year_month"])
        year_s, month_s = ym.split("-", 1)
        day = date(int(year_s), int(month_s), 1)
        await store.ensure_month_goals(day)
        print(f"month_goals OK: {ym}")

    await store.close()
    print("Готово.")


if __name__ == "__main__":
    asyncio.run(main())
