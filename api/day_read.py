"""Чтение одного дня из Postgres (для Mini App: «уже заполнено»)."""

from __future__ import annotations

import sys
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "bot"))

from spheres import SPHERES  # noqa: E402
from sport_fields import SPORT_FIELD_BY_COL  # noqa: E402


def build_day_payload(conn: psycopg.Connection, day_iso: str) -> dict:
    month_key = day_iso[:7]
    routine_template = [
        {
            "col": sp.col_1based,
            "name": sp.name,
            "value": None,
        }
        for sp in SPHERES
    ]

    day_row = conn.execute(
        "SELECT id FROM days WHERE day_date = %s",
        (day_iso,),
    ).fetchone()

    if day_row is None:
        return {
            "ok": True,
            "date": day_iso,
            "month": month_key,
            "exists": False,
            "row1Based": None,
            "routine": routine_template,
            "sport": [],
            "hasRoutine": False,
            "hasSport": False,
        }

    day_id = day_row["id"]

    routine_rows = conn.execute(
        """
        SELECT sphere, value
        FROM routine_values
        WHERE day_id = %s
        ORDER BY sphere
        """,
        (day_id,),
    ).fetchall()
    routine_by_col = {int(r["sphere"]): int(r["value"]) for r in routine_rows}

    routine = [
        {
            "col": sp.col_1based,
            "name": sp.name,
            "value": routine_by_col.get(sp.col_1based),
        }
        for sp in SPHERES
    ]

    sport_rows = conn.execute(
        """
        SELECT field, value
        FROM sport_values
        WHERE day_id = %s
        ORDER BY field::int
        """,
        (day_id,),
    ).fetchall()

    sport = []
    for row in sport_rows:
        try:
            col = int(row["field"])
        except (TypeError, ValueError):
            continue
        field = SPORT_FIELD_BY_COL.get(col)
        sport.append(
            {
                "col": col,
                "label": field.label if field else f"col {col}",
                "value": str(row["value"]),
            }
        )

    has_routine = len(routine_rows) > 0
    has_sport = len(sport) > 0

    return {
        "ok": True,
        "date": day_iso,
        "month": month_key,
        "exists": True,
        "row1Based": int(day_id),
        "routine": routine,
        "sport": sport,
        "hasRoutine": has_routine,
        "hasSport": has_sport,
    }
