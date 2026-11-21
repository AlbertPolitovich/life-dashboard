"""Создание месяца и целей в Postgres (как prepare_day в SQL-боте)."""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "bot"))
sys.path.insert(0, str(ROOT / "!bot_SQL"))

from routine_month_goals import routine_goal_targets  # noqa: E402
from sport_month_goals import sport_month_goal_targets  # noqa: E402


def ensure_month(conn: psycopg.Connection, month_key: str) -> int:
    row = conn.execute(
        """
        INSERT INTO months (year_month)
        VALUES (%s)
        ON CONFLICT (year_month) DO NOTHING
        RETURNING id
        """,
        (month_key,),
    ).fetchone()
    if row:
        return int(row["id"])

    existing = conn.execute(
        "SELECT id FROM months WHERE year_month = %s",
        (month_key,),
    ).fetchone()
    if existing is None:
        raise RuntimeError(f"Не удалось создать месяц {month_key}")
    return int(existing["id"])


def ensure_month_goals(conn: psycopg.Connection, month_id: int, month_key: str) -> int:
    year_s, month_s = month_key.split("-", 1)
    day = date(int(year_s), int(month_s), 1)
    targets: list[tuple[str, int]] = [
        (str(col), val) for col, val in routine_goal_targets(day.year, day.month)
    ]
    sport = sport_month_goal_targets(day.year)
    if sport:
        targets.extend((str(col), val) for col, val in sport)

    for target_key, goal_value in targets:
        conn.execute(
            """
            INSERT INTO month_goals (month_id, kind, target_key, value)
            VALUES (%s, 'goal', %s, %s)
            ON CONFLICT (month_id, kind, target_key)
            DO UPDATE SET value = EXCLUDED.value
            """,
            (month_id, target_key, goal_value),
        )
    return len(targets)


def ensure_month_record(conn: psycopg.Connection, month_key: str) -> int:
    """Месяц + цели; id months.id."""
    month_id = ensure_month(conn, month_key)
    ensure_month_goals(conn, month_id, month_key)
    return month_id
