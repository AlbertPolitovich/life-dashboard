"""Цели routine на месяц по числу дней в календаре (как в Google Sheets)."""

from __future__ import annotations

import calendar

import _bootstrap  # noqa: F401

from spheres import SPHERES

# Порядок значений = SPHERES (B..I): семья, спорт/здоровье, экономика, …
ROUTINE_GOALS_BY_DAYS_IN_MONTH: dict[int, tuple[int, ...]] = {
    28: (27, 23, 15, 15, 20, 23, 6, 8),
    30: (29, 23, 15, 15, 20, 23, 6, 8),
    31: (29, 23, 16, 16, 21, 23, 6, 8),
}


def routine_goals_for_calendar_month(year: int, month: int) -> tuple[int, ...]:
    """Цели по сферам для year-month; февраль 29 дней → шаблон 30-дневного месяца."""
    days_in_month = calendar.monthrange(year, month)[1]
    if days_in_month == 29:
        return ROUTINE_GOALS_BY_DAYS_IN_MONTH[30]
    try:
        return ROUTINE_GOALS_BY_DAYS_IN_MONTH[days_in_month]
    except KeyError as exc:
        raise ValueError(
            f"Нет шаблона целей для месяца с {days_in_month} днями "
            f"({year}-{month:02d})"
        ) from exc


def routine_goal_targets(year: int, month: int) -> list[tuple[int, int]]:
    """Список (sphere col 2..9, goal value) для записи в month_goals."""
    goals = routine_goals_for_calendar_month(year, month)
    return [(s.col_1based, g) for s, g in zip(SPHERES, goals, strict=True)]
