"""Недельная продуктивность (routine): факт за пн–вс, цель — доля месячной."""

from __future__ import annotations

import calendar
import sys
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "bot"))

from spheres import SPHERES  # noqa: E402

from month_read import (  # noqa: E402
    _goal_map,
    aggregate_sport_values,
    build_sport_from_aggregates,
    month_title_ru,
)
from month_ensure import ensure_month_record  # noqa: E402
from routine_summary import build_routine_period_summary  # noqa: E402

_MONTH_NAMES_GEN = {
    1: "января",
    2: "февраля",
    3: "марта",
    4: "апреля",
    5: "мая",
    6: "июня",
    7: "июля",
    8: "августа",
    9: "сентября",
    10: "октября",
    11: "ноября",
    12: "декабря",
}


def monday_of_week(d: date) -> date:
    return d - timedelta(days=d.weekday())


def sunday_of_week(d: date) -> date:
    return monday_of_week(d) + timedelta(days=6)


def dates_between(start: date, end: date) -> list[date]:
    out: list[date] = []
    cur = start
    while cur <= end:
        out.append(cur)
        cur += timedelta(days=1)
    return out


def count_overlap_days(week_start: date, week_end: date, month_key: str) -> int:
    y, m = map(int, month_key.split("-"))
    n = 0
    for d in dates_between(week_start, week_end):
        if d.year == y and d.month == m:
            n += 1
    return n


def overlapping_month_keys(week_start: date, week_end: date) -> list[str]:
    keys: set[str] = set()
    for d in dates_between(week_start, week_end):
        keys.add(f"{d.year:04d}-{d.month:02d}")
    return sorted(keys)


def month_goals_by_sphere(conn: psycopg.Connection, month_key: str) -> dict[str, int]:
    month_row = conn.execute(
        "SELECT id FROM months WHERE year_month = %s",
        (month_key,),
    ).fetchone()
    if month_row is None:
        month_id = ensure_month_record(conn, month_key)
    else:
        month_id = month_row["id"]
    goals = conn.execute(
        """
        SELECT target_key, value
        FROM month_goals
        WHERE month_id = %s AND kind = 'goal'
        """,
        (month_id,),
    ).fetchall()
    return _goal_map(goals)


def routine_week_goals_by_sphere(
    conn: psycopg.Connection,
    week_start: date,
    week_end: date,
) -> dict[int, int]:
    goal_by_col: dict[int, int] = {sp.col_1based: 0 for sp in SPHERES}
    for month_key in overlapping_month_keys(week_start, week_end):
        days_overlap = count_overlap_days(week_start, week_end, month_key)
        if days_overlap <= 0:
            continue
        y, m = map(int, month_key.split("-"))
        days_in_month = calendar.monthrange(y, m)[1]
        goals_by_key = month_goals_by_sphere(conn, month_key)
        for sp in SPHERES:
            month_goal = int(goals_by_key.get(str(sp.col_1based), 0))
            goal_by_col[sp.col_1based] += prorate_week_goal(
                month_goal, days_overlap, days_in_month
            )
    return goal_by_col


def week_label_ru(week_start: date, week_end: date, month_key: str) -> str:
    y, m = map(int, month_key.split("-"))
    parts: list[str] = []
    for d in dates_between(week_start, week_end):
        if d.year == y and d.month == m:
            parts.append(f"{d.day} {_MONTH_NAMES_GEN[d.month]}")
    if not parts:
        return f"{week_start.day}–{week_end.day}"
    if week_start.month == week_end.month and week_start.year == week_end.year:
        if week_start.day == week_end.day:
            return parts[0]
        return f"{week_start.day}–{week_end.day} {_MONTH_NAMES_GEN[week_start.month]}"
    return f"{week_start.day}.{week_start.month:02d}–{week_end.day}.{week_end.month:02d}"


def prorate_week_goal(month_goal: int, days_overlap: int, days_in_month: int) -> int:
    if month_goal <= 0 or days_overlap <= 0 or days_in_month <= 0:
        return 0
    return max(0, round(month_goal * days_overlap / days_in_month))


def build_week_payload(conn: psycopg.Connection, anchor_iso: str, month_key: str) -> dict:
    anchor = date.fromisoformat(anchor_iso)
    week_start = monday_of_week(anchor)
    week_end = sunday_of_week(anchor)
    days_in_month = calendar.monthrange(anchor.year, anchor.month)[1]
    if month_key != anchor_iso[:7]:
        y, m = map(int, month_key.split("-"))
        days_in_month = calendar.monthrange(y, m)[1]

    days_overlap = count_overlap_days(week_start, week_end, month_key)
    if days_overlap <= 0:
        return {
            "ok": False,
            "error": f"Неделя {week_start}–{week_end} не пересекается с месяцем {month_key}",
            "month": month_key,
        }

    goals_by_key = month_goals_by_sphere(conn, month_key)

    # Факт считаем по всему диапазону пн–вс, а не по month_id: неделя может
    # захватывать дни соседнего месяца (day_date глобально уникален —
    # двойного учёта нет). Иначе дни другого месяца выпадают из суммы.
    routine_facts = conn.execute(
        """
        SELECT r.sphere::text AS sphere, SUM(r.value)::bigint AS fact
        FROM routine_values r
        JOIN days d ON d.id = r.day_id
        WHERE d.day_date >= %s
          AND d.day_date <= %s
        GROUP BY r.sphere
        ORDER BY r.sphere
        """,
        (week_start, week_end),
    ).fetchall()

    fact_by_sphere = {int(row["sphere"]): int(row["fact"]) for row in routine_facts}
    week_goals_by_col = routine_week_goals_by_sphere(conn, week_start, week_end)

    rows = []
    for sp in SPHERES:
        col = sp.col_1based
        fact = fact_by_sphere.get(col, 0)
        month_goal = int(goals_by_key.get(str(col), 0))
        goal = week_goals_by_col.get(col, 0)
        progress = round((fact / goal) * 100) if goal > 0 else 0
        rows.append(
            {
                "sphere": sp.name,
                "fact": fact,
                "goal": goal,
                "monthGoal": month_goal,
                "progress": progress,
            }
        )

    routine_summary = build_routine_period_summary(
        conn, week_start, week_end
    )

    sport_rows = conn.execute(
        """
        SELECT s.field, s.value
        FROM sport_values s
        JOIN days d ON d.id = s.day_id
        WHERE d.day_date >= %s
          AND d.day_date <= %s
        """,
        (week_start, week_end),
    ).fetchall()
    sport_sums, sport_stat_vals = aggregate_sport_values(sport_rows)
    # Sport is tracked as a real Mon-Sun week. Routine remains month-overlap based,
    # but sport goals should be a full weekly slice of monthly targets.
    sport_goal_days = 7
    sport, sport_by_type = build_sport_from_aggregates(
        month_key,
        goals_by_key,
        sport_sums,
        sport_stat_vals,
        sport_goal_days,
        days_in_month,
    )

    return {
        "ok": True,
        "period": "week",
        "month": month_key,
        "anchorDate": anchor_iso,
        "weekStart": week_start.isoformat(),
        "weekEnd": week_end.isoformat(),
        "weekLabel": week_label_ru(week_start, week_end, month_key),
        "monthTitle": month_title_ru(month_key),
        "daysInMonth": days_in_month,
        "daysOverlap": days_overlap,
        "sportDays": sport_goal_days,
        "rows": rows,
        "routineSummary": routine_summary,
        "sport": sport,
        "sportByType": sport_by_type,
    }
