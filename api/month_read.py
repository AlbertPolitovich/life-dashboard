"""Сборка JSON месяца из Postgres (формат как doGet)."""

from __future__ import annotations

import calendar
import re
import sys
from collections import defaultdict
from datetime import date
from decimal import Decimal
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "bot"))

from spheres import SPHERES  # noqa: E402
from sport_fields import SPORT_FIELD_BY_COL  # noqa: E402

from dashboard_constants import (  # noqa: E402
    DEFAULT_ITOG_MINUTES,
    SPORT_AVG_COLS,
    SPORT_DETAIL_BLOCKS,
    SPORT_GOAL_MINUTES_FALLBACK,
    SPORT_ITOG_MINUTES_GOAL,
    SPORT_MIN_COLS,
    SPORT_STAT_COLS,
    SPORT_TYPE_COLS,
)
from month_ensure import ensure_month_record  # noqa: E402
from routine_summary import build_routine_period_summary  # noqa: E402

_NUM_RE = re.compile(r"^-?\d+([.,]\d+)?$")


def month_title_ru(key: str) -> str:
    names = {
        "01": "Январь",
        "02": "Февраль",
        "03": "Март",
        "04": "Апрель",
        "05": "Май",
        "06": "Июнь",
        "07": "Июль",
        "08": "Август",
        "09": "Сентябрь",
        "10": "Октябрь",
        "11": "Ноябрь",
        "12": "Декабрь",
    }
    parts = key.split("-")
    if len(parts) != 2:
        return key
    mon = names.get(parts[1], parts[1])
    return f"{mon.lower()} {parts[0]}"


def short_sport_label(full: str) -> str:
    return full.replace(", min", "").replace(", Min", "").strip()


def parse_numeric(raw: str | None) -> float | None:
    if raw is None:
        return None
    s = str(raw).strip().replace("\u00a0", " ")
    if not s or not _NUM_RE.match(s):
        return None
    return float(s.replace(",", "."))


def _round2(x: float) -> float:
    return round(x * 100) / 100


def _goal_map(goals: list[dict]) -> dict[str, float]:
    out: dict[str, float] = {}
    for row in goals:
        key = str(row["target_key"])
        val = row["value"]
        if val is None:
            continue
        if isinstance(val, Decimal):
            out[key] = float(val)
        else:
            out[key] = float(val)
    return out


def build_month_payload(conn: psycopg.Connection, month_key: str) -> dict:
    month_row = conn.execute(
        "SELECT id FROM months WHERE year_month = %s",
        (month_key,),
    ).fetchone()
    if month_row is None:
        month_id = ensure_month_record(conn, month_key)
    else:
        month_id = month_row["id"]

    routine_facts = conn.execute(
        """
        SELECT r.sphere::text AS sphere, SUM(r.value)::bigint AS fact
        FROM routine_values r
        JOIN days d ON d.id = r.day_id
        WHERE d.month_id = %s
        GROUP BY r.sphere
        ORDER BY r.sphere
        """,
        (month_id,),
    ).fetchall()

    fact_by_sphere: dict[int, int] = {
        int(row["sphere"]): int(row["fact"]) for row in routine_facts
    }

    goals = conn.execute(
        """
        SELECT target_key, value
        FROM month_goals
        WHERE month_id = %s AND kind = 'goal'
        """,
        (month_id,),
    ).fetchall()
    goals_by_key = _goal_map(goals)

    rows = []
    for sp in SPHERES:
        col = sp.col_1based
        fact = fact_by_sphere.get(col, 0)
        goal = int(goals_by_key.get(str(col), 0))
        progress = round((fact / goal) * 100) if goal > 0 else 0
        rows.append(
            {
                "sphere": sp.name,
                "fact": fact,
                "goal": goal,
                "progress": progress,
            }
        )

    sport_rows = conn.execute(
        """
        SELECT s.field, s.value
        FROM sport_values s
        JOIN days d ON d.id = s.day_id
        WHERE d.month_id = %s
        """,
        (month_id,),
    ).fetchall()

    sums, stat_vals = aggregate_sport_values(sport_rows)
    sport, sport_by_type = build_sport_from_aggregates(
        month_key, goals_by_key, sums, stat_vals
    )

    y, m = map(int, month_key.split("-"))
    routine_summary = build_routine_period_summary(
        conn,
        date(y, m, 1),
        date(y, m, calendar.monthrange(y, m)[1]),
    )

    return {
        "ok": True,
        "month": month_key,
        "rows": rows,
        "sport": sport,
        "sportByType": sport_by_type,
        "routineSummary": routine_summary,
    }


def aggregate_sport_values(sport_rows) -> tuple[dict[int, float], dict[int, list[float]]]:
    sums: dict[int, float] = defaultdict(float)
    stat_vals: dict[int, list[float]] = defaultdict(list)
    for row in sport_rows:
        try:
            col = int(row["field"])
        except (TypeError, ValueError):
            continue
        num = parse_numeric(row["value"])
        if num is None:
            continue
        if col in SPORT_AVG_COLS:
            stat_vals[col].append(num)
        else:
            sums[col] += num
    return sums, stat_vals


def _effective_goals(
    goals_by_key: dict[str, float],
    days_overlap: int | None = None,
    days_in_month: int | None = None,
) -> dict[str, float]:
    if not days_overlap or not days_in_month:
        return goals_by_key
    from week_read import prorate_week_goal

    return {
        k: float(prorate_week_goal(int(v or 0), days_overlap, days_in_month))
        for k, v in goals_by_key.items()
    }


def build_sport_from_aggregates(
    month_key: str,
    goals_by_key: dict[str, float],
    sums: dict[int, float],
    stat_vals: dict[int, list[float]],
    days_overlap: int | None = None,
    days_in_month: int | None = None,
) -> tuple[dict, dict]:
    eff_goals = _effective_goals(goals_by_key, days_overlap, days_in_month)
    sport = _build_sport_block(
        month_key, eff_goals, sums, days_overlap, days_in_month
    )
    sport_by_type = _build_sport_by_type(month_key, eff_goals, sums, stat_vals)
    sport_by_type["blocks"] = _build_sport_detail_blocks(eff_goals, sums, stat_vals)
    return sport, sport_by_type


def _build_sport_block(
    month_key: str,
    goals_by_key: dict[str, float],
    sums: dict[int, float],
    days_overlap: int | None = None,
    days_in_month: int | None = None,
) -> dict:
    by_min_column = []
    total_fact = 0.0
    total_goal_from_sheet = 0.0

    for col in SPORT_MIN_COLS:
        field = SPORT_FIELD_BY_COL.get(col)
        label = field.label if field else f"col {col}"
        goal_part = goals_by_key.get(str(col), 0.0)
        minutes = _round2(sums.get(col, 0.0))
        total_fact += minutes
        total_goal_from_sheet += goal_part
        pr = round((minutes / goal_part) * 100) if goal_part > 0 else 0
        by_min_column.append(
            {
                "label": label,
                "shortLabel": short_sport_label(label),
                "minutes": minutes,
                "goalPart": goal_part,
                "progress": pr,
            }
        )

    total_fact = _round2(total_fact)
    sum_goals_row = total_goal_from_sheet
    kpi_den = sum_goals_row
    goal_source = "sum minute goals from month_goals"

    override = SPORT_ITOG_MINUTES_GOAL.get(month_key)
    if override is not None and override > 0:
        kpi_den = float(override)
        if days_overlap and days_in_month:
            from week_read import prorate_week_goal

            kpi_den = float(
                prorate_week_goal(int(override), days_overlap, days_in_month)
            )
        goal_source = f"SPORT_ITOG_MINUTES_GOAL[{month_key}]"
    elif not kpi_den or kpi_den <= 0:
        fb = SPORT_GOAL_MINUTES_FALLBACK.get(month_key)
        if fb is not None and fb > 0:
            kpi_den = float(fb)
            goal_source = f"fallback:SPORT_GOAL_MINUTES_FALLBACK[{month_key}]"
        else:
            kpi_den = float(DEFAULT_ITOG_MINUTES)
            goal_source = f"default:{DEFAULT_ITOG_MINUTES}"

    progress_total = (
        round((total_fact / kpi_den) * 1000) / 10 if kpi_den > 0 else 0.0
    )

    return {
        "monthKey": month_key,
        "monthTitle": month_title_ru(month_key),
        "totalMinutes": total_fact,
        "goalTotalMinutes": kpi_den,
        "goalMinutes": kpi_den,
        "goalSumSportTargets": sum_goals_row,
        "sportGoalRow1Based": None,
        "goalSource": goal_source,
        "progress": progress_total,
        "byMinColumn": by_min_column,
    }


def _build_sport_by_type(
    month_key: str,
    goals_by_key: dict[str, float],
    sums: dict[int, float],
    stat_vals: dict[int, list[float]],
) -> dict:
    by_type_column = []
    for col in SPORT_TYPE_COLS:
        field = SPORT_FIELD_BY_COL.get(col)
        label = field.label if field else f"col {col}"
        goal_part = goals_by_key.get(str(col), 0.0)
        fact = _round2(sums.get(col, 0.0))
        pr = round((fact / goal_part) * 100) if goal_part > 0 else 0
        by_type_column.append(
            {
                "label": label,
                "shortLabel": short_sport_label(label),
                "fact": fact,
                "goal": goal_part,
                "progress": pr,
            }
        )

    stat_pills = []
    for col, key in SPORT_STAT_COLS:
        vals = stat_vals.get(col)
        if not vals:
            continue
        field = SPORT_FIELD_BY_COL.get(col)
        hdr = field.label if field else f"col {col}"
        avg = sum(vals) / len(vals)
        val = str(round(avg)) if key == "hrCycling" else str(_round2(avg))
        stat_pills.append(
            {
                "key": key,
                "label": hdr,
                "shortLabel": short_sport_label(hdr),
                "value": val,
                "cell": f"sql:avg:{col}",
            }
        )

    return {
        "monthKey": month_key,
        "monthTitle": month_title_ru(month_key),
        "byTypeColumn": by_type_column,
        "statPills": stat_pills,
    }


_SPORT_ROW_LABELS_RU: dict[int, str] = {
    10: "Разминка",
    11: "Растяжка",
    12: "Pull ups",
    13: "Push ups",
    14: "Workout",
    15: "Бег (км)",
    16: "Бег (мин)",
    17: "Pace",
    18: "HR run",
    19: "Cycling (км)",
    20: "Cycling (мин)",
    21: "Wt",
    22: "HR cycling",
}


def _sport_unit(col: int, label: str) -> str:
    low = label.lower()
    if col in (15, 19) or ", km" in low:
        return "км"
    if ", min" in low or "min" in low:
        return "мин"
    return ""


def _sport_row_fact(
    col: int,
    goals_by_key: dict[str, float],
    sums: dict[int, float],
    stat_vals: dict[int, list[float]],
) -> float | None:
    if col in SPORT_AVG_COLS:
        vals = stat_vals.get(col)
        if not vals:
            return None
        return _round2(sum(vals) / len(vals))
    if col in sums:
        return _round2(sums[col])
    if float(goals_by_key.get(str(col), 0) or 0) > 0:
        return 0.0
    return None


def _build_sport_detail_blocks(
    goals_by_key: dict[str, float],
    sums: dict[int, float],
    stat_vals: dict[int, list[float]],
) -> list[dict]:
    blocks = []
    for block_id, title, cols in SPORT_DETAIL_BLOCKS:
        rows = []
        for col in cols:
            field = SPORT_FIELD_BY_COL.get(col)
            label = field.label if field else f"col {col}"
            display = _SPORT_ROW_LABELS_RU.get(col) or short_sport_label(label)
            fact = _sport_row_fact(col, goals_by_key, sums, stat_vals)
            if fact is None:
                continue
            goal = float(goals_by_key.get(str(col), 0) or 0)
            progress = round((fact / goal) * 100) if goal > 0 else None
            rows.append(
                {
                    "col": col,
                    "label": label,
                    "displayLabel": display,
                    "fact": fact,
                    "goal": goal,
                    "progress": progress,
                    "unit": _sport_unit(col, label),
                    "agg": "avg" if col in SPORT_AVG_COLS else "sum",
                }
            )
        if rows:
            blocks.append({"id": block_id, "title": title, "rows": rows})
    return blocks
