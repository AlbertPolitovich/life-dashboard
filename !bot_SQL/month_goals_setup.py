"""Сборка и запись месячных целей (routine + sport) в month_goals."""

from __future__ import annotations

from datetime import date

import asyncpg

from routine_month_goals import routine_goal_targets
from sport_month_goals import sport_month_goal_targets


def month_goal_targets_for_day(day: date) -> list[tuple[str, int]]:
    """
    Все цели месяца для даты: (target_key, value).
    target_key: '2'..'9' routine, '10'..'22' sport.
    """
    targets: list[tuple[str, int]] = [
        (str(col), val) for col, val in routine_goal_targets(day.year, day.month)
    ]
    sport = sport_month_goal_targets(day.year)
    if sport:
        targets.extend((str(col), val) for col, val in sport)
    return targets


async def upsert_month_goals(
    conn: asyncpg.Connection, month_id: int, day: date
) -> int:
    """Записать/обновить цели; возвращает число строк."""
    targets = month_goal_targets_for_day(day)
    for target_key, goal_value in targets:
        await conn.execute(
            """
            INSERT INTO month_goals (month_id, kind, target_key, value)
            VALUES ($1, 'goal', $2, $3)
            ON CONFLICT (month_id, kind, target_key)
            DO UPDATE SET value = EXCLUDED.value
            """,
            month_id,
            target_key,
            goal_value,
        )
    return len(targets)
