"""Месячные цели sport (одинаковые каждый месяц в 2026)."""

from __future__ import annotations

# (col 1-based, goal) — Warm up, Str, Workout, Run km/time, Cycling km/time
SPORT_MONTH_GOALS_2026: tuple[tuple[int, int], ...] = (
    (10, 200),
    (11, 60),
    (14, 150),
    (15, 21),
    (16, 150),
    (19, 600),
    (20, 1100),
)


def sport_month_goal_targets(year: int) -> list[tuple[int, int]] | None:
    """Цели sport на месяц. Сейчас заданы только для 2026."""
    if year != 2026:
        return None
    return list(SPORT_MONTH_GOALS_2026)
