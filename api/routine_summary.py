"""Сводка рутины N/8 за период (дни с записью в routine_values)."""

from __future__ import annotations

from datetime import date
from typing import Any

import psycopg

ROUTINE_SLOTS_PER_DAY = 8


def build_routine_period_summary(
    conn: psycopg.Connection,
    start: date,
    end: date,
) -> dict[str, Any]:
    # Считаем по диапазону дат, а не по month_id: период (например неделя
    # пн–вс) может пересекать границу месяца, и дни соседнего месяца не
    # должны выпадать. day_date уникален — двойного учёта нет.
    per_day = conn.execute(
        """
        SELECT d.day_date,
               COALESCE(SUM(CASE WHEN r.value = 1 THEN 1 ELSE 0 END), 0)::int AS done
        FROM days d
        INNER JOIN routine_values r ON r.day_id = d.id
        WHERE d.day_date >= %s
          AND d.day_date <= %s
        GROUP BY d.day_date
        ORDER BY d.day_date
        """,
        (start, end),
    ).fetchall()
    saved_days = len(per_day)
    done = sum(int(row["done"]) for row in per_day)
    total = ROUTINE_SLOTS_PER_DAY * saved_days if saved_days > 0 else ROUTINE_SLOTS_PER_DAY
    pct = round(100 * done / total) if total > 0 else 0
    return {
        "done": done,
        "total": total,
        "perDay": ROUTINE_SLOTS_PER_DAY,
        "savedDays": saved_days,
        "pct": pct,
    }
