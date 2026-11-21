#!/usr/bin/env python3
"""
Импорт Rut_Sport.xlsx → routine_values + sport_values.

Янв–Апр 2026: months, days, month_goals, routine, sport.
Май 2026: только sport (routine уже в БД).

Примеры:
  python import_routine_sport.py "/Users/artem/Downloads/Rut_Sport.xlsx"
  python import_routine_sport.py Rut_Sport.xlsx --dry-run
  python import_routine_sport.py Rut_Sport.xlsx --month 2026-05
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import date, datetime, time
from pathlib import Path

import openpyxl
import psycopg
from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "bot"))
sys.path.insert(0, str(ROOT / "!bot_SQL"))

from routine_month_goals import routine_goal_targets  # noqa: E402
from sport_fields import PACE_COL_1BASED  # noqa: E402
from sport_month_goals import sport_month_goal_targets  # noqa: E402
from sport_parse import parse_sport_number  # noqa: E402
from spheres import SPHERES  # noqa: E402

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://life:life@localhost:5432/life_dashboard",
).strip()

SPORT_COLS = range(10, 23)
_PACE_RE = re.compile(r"^(\d{1,2}):(\d{2}):(\d{2})$")

# yyyy-MM → что импортировать
IMPORT_PLAN: dict[str, dict[str, bool]] = {
    "2026-01": {"routine": True, "sport": True, "create_month": True},
    "2026-02": {"routine": True, "sport": True, "create_month": True},
    "2026-03": {"routine": True, "sport": True, "create_month": True},
    "2026-04": {"routine": True, "sport": True, "create_month": True},
    "2026-05": {"routine": False, "sport": True, "create_month": False},
}


def normalize_sport_value(col: int, value: object) -> str | None:
    if value is None:
        return None

    if col == PACE_COL_1BASED:
        if isinstance(value, time):
            return f"{value.hour:02d}:{value.minute:02d}:{value.second:02d}"
        match = _PACE_RE.match(str(value).strip())
        if not match:
            return None
        minutes = int(match.group(1))
        seconds = int(match.group(2))
        if seconds > 59 or minutes < 0:
            return None
        return f"{minutes:02d}:{seconds:02d}:{match.group(3)}"

    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        text = str(value).replace(".", ",")
    else:
        text = str(value).strip().replace(".", ",")

    num = parse_sport_number(text)
    if num is None:
        return None
    if isinstance(num, float):
        return str(num).replace(".", ",")
    return str(num)


def parse_day_cell(value: object) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return None


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


def ensure_day(conn: psycopg.Connection, month_id: int, day_date: date) -> int:
    row = conn.execute(
        """
        INSERT INTO days (month_id, day_date)
        VALUES (%s, %s)
        ON CONFLICT (day_date) DO NOTHING
        RETURNING id
        """,
        (month_id, day_date),
    ).fetchone()
    if row:
        return int(row["id"])

    existing = conn.execute(
        "SELECT id FROM days WHERE day_date = %s",
        (day_date,),
    ).fetchone()
    if existing is None:
        raise RuntimeError(f"Не удалось создать день {day_date}")
    return int(existing["id"])


def upsert_routine(
    conn: psycopg.Connection, day_id: int, values: list[int], dry_run: bool
) -> int:
    written = 0
    for sphere, value in zip(SPHERES, values, strict=True):
        if dry_run:
            written += 1
            continue
        conn.execute(
            """
            INSERT INTO routine_values (day_id, sphere, value)
            VALUES (%s, %s, %s)
            ON CONFLICT (day_id, sphere)
            DO UPDATE SET value = EXCLUDED.value
            """,
            (day_id, sphere.col_1based, value),
        )
        written += 1
    return written


def upsert_sport_cell(
    conn: psycopg.Connection, day_id: int, col: int, stored: str, dry_run: bool
) -> int:
    if dry_run:
        return 1
    conn.execute(
        """
        INSERT INTO sport_values (day_id, field, value)
        VALUES (%s, %s, %s)
        ON CONFLICT (day_id, field)
        DO UPDATE SET value = EXCLUDED.value
        """,
        (day_id, str(col), stored),
    )
    return 1


def import_sheet(
    conn: psycopg.Connection,
    ws: openpyxl.worksheet.worksheet.Worksheet,
    month_key: str,
    plan: dict[str, bool],
    dry_run: bool,
) -> dict[str, int]:
    stats = {
        "days": 0,
        "routine_cells": 0,
        "sport_cells": 0,
        "skipped_days": 0,
    }

    month_id: int | None = None
    if plan["create_month"]:
        if dry_run:
            existing = conn.execute(
                "SELECT id FROM months WHERE year_month = %s",
                (month_key,),
            ).fetchone()
            month_id = int(existing["id"]) if existing else -1
        else:
            month_id = ensure_month(conn, month_key)
            ensure_month_goals(conn, month_id, month_key)

    for row_idx in range(2, ws.max_row + 1):
        day_date = parse_day_cell(ws.cell(row_idx, 1).value)
        if day_date is None or day_date.strftime("%Y-%m") != month_key:
            continue

        stats["days"] += 1

        if plan["create_month"]:
            if dry_run and month_id == -1:
                day_id = -1
            else:
                assert month_id is not None
                day_id = ensure_day(conn, month_id, day_date)
        else:
            row = conn.execute(
                "SELECT id FROM days WHERE day_date = %s",
                (day_date,),
            ).fetchone()
            if row is None:
                stats["skipped_days"] += 1
                continue
            day_id = int(row["id"])

        if plan["routine"]:
            routine_vals: list[int] = []
            for col in range(2, 10):
                raw = ws.cell(row_idx, col).value
                if raw is None:
                    raise ValueError(
                        f"{month_key} {day_date}: пустая routine-ячейка col {col}"
                    )
                routine_vals.append(int(raw))
            stats["routine_cells"] += upsert_routine(
                conn, day_id, routine_vals, dry_run
            )

        if plan["sport"]:
            for col in SPORT_COLS:
                raw = ws.cell(row_idx, col).value
                if raw is None:
                    continue
                stored = normalize_sport_value(col, raw)
                if stored is None:
                    raise ValueError(
                        f"{month_key} {day_date}: не удалось нормализовать "
                        f"col {col} value={raw!r}"
                    )
                stats["sport_cells"] += upsert_sport_cell(
                    conn, day_id, col, stored, dry_run
                )

    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description="Импорт Rut_Sport.xlsx")
    parser.add_argument("xlsx", type=Path, help="Путь к Rut_Sport.xlsx")
    parser.add_argument("--dry-run", action="store_true", help="Без записи в БД")
    parser.add_argument(
        "--month",
        metavar="YYYY-MM",
        help="Импортировать только указанный месяц",
    )
    args = parser.parse_args()

    if not args.xlsx.is_file():
        print(f"Файл не найден: {args.xlsx}", file=sys.stderr)
        return 1

    months = (
        {args.month.strip()}
        if args.month
        else set(IMPORT_PLAN.keys())
    )
    unknown = months - set(IMPORT_PLAN.keys())
    if unknown:
        print(f"Месяц не в плане импорта: {', '.join(sorted(unknown))}", file=sys.stderr)
        return 1

    wb = openpyxl.load_workbook(args.xlsx, data_only=True)
    missing = [m for m in sorted(months) if m not in wb.sheetnames]
    if missing:
        print(f"Нет листов в Excel: {', '.join(missing)}", file=sys.stderr)
        return 1

    totals = {"days": 0, "routine_cells": 0, "sport_cells": 0, "skipped_days": 0}

    with psycopg.connect(DATABASE_URL, row_factory=psycopg.rows.dict_row) as conn:
        for month_key in sorted(months):
            plan = IMPORT_PLAN[month_key]
            stats = import_sheet(conn, wb[month_key], month_key, plan, args.dry_run)
            mode = []
            if plan["routine"]:
                mode.append("routine")
            if plan["sport"]:
                mode.append("sport")
            print(
                f"{month_key} [{', '.join(mode)}]: "
                f"дней={stats['days']}, "
                f"routine={stats['routine_cells']}, "
                f"sport={stats['sport_cells']}, "
                f"пропущено дней={stats['skipped_days']}"
            )
            for key in totals:
                totals[key] += stats[key]

        if not args.dry_run:
            conn.commit()

    suffix = " (dry-run)" if args.dry_run else ""
    print(
        f"Итого{suffix}: дней={totals['days']}, "
        f"routine={totals['routine_cells']}, sport={totals['sport_cells']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
