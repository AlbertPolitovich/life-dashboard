#!/usr/bin/env python3
"""
Импорт Ledger.xlsx → ledger_allocations + ledger_maintenance_events.

Примеры:
  python import_ledger.py "/Users/artem/Downloads/Ledger.xlsx"
  python import_ledger.py Ledger.xlsx --dry-run
  python import_ledger.py Ledger.xlsx --reset
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

import openpyxl
import psycopg
from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))

from ledger_common import (  # noqa: E402
    CAR_CONSUMABLE_COLUMNS,
    map_consumable_sub_bucket,
    map_service_purpose,
    map_service_sub_bucket,
    parse_positive_amount,
)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://life:life@localhost:5432/life_dashboard",
).strip()

SHEET_APARTMENT = "квартира_ипотека и ремонт"
SHEET_CAR_SERVICE = "машина_ремонт обслуживание"
SHEET_CAR_CONSUMABLES = "машина_расходники"
SHEET_CAR_REMINDERS = "машина_напоминания"


def cell_date(value: object) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, (int, float)):
        base = date(1899, 12, 30)
        from datetime import timedelta

        return base + timedelta(days=int(value))
    return None


def cell_amount(value: object) -> float | None:
    if isinstance(value, (int, float)):
        return parse_positive_amount(value)
    return parse_positive_amount(value)


def get_asset_id(conn: psycopg.Connection, slug: str) -> int:
    row = conn.execute("SELECT id FROM ledger_assets WHERE slug = %s", (slug,)).fetchone()
    if not row:
        raise RuntimeError(f"Объект {slug} не найден — сначала миграция 006_ledger.sql")
    return int(row["id"])


def clear_import_data(conn: psycopg.Connection) -> None:
    conn.execute("DELETE FROM ledger_allocations WHERE source = 'ledger_import'")
    conn.execute("DELETE FROM ledger_maintenance_events WHERE source = 'ledger_import'")


def import_apartment(ws, conn: psycopg.Connection, asset_id: int, *, dry_run: bool) -> int:
    count = 0
    for row in ws.iter_rows(min_row=3, values_only=True):
        if not row:
            continue
        tx_date = cell_date(row[0])
        if not tx_date:
            continue
        comment = str(row[4] or "").strip() or None
        pairs = (
            ("mortgage", row[1]),
            ("repair", row[2]),
            ("misc", row[3]),
        )
        for bucket, raw_amount in pairs:
            amount = cell_amount(raw_amount)
            if amount is None:
                continue
            if not dry_run:
                conn.execute(
                    """
                    INSERT INTO ledger_allocations (
                        asset_id, tx_date, amount, bucket, label, source
                    ) VALUES (%s, %s, %s, %s, %s, 'ledger_import')
                    """,
                    (asset_id, tx_date, Decimal(str(amount)), bucket, comment),
                )
            count += 1
    return count


def import_car_service(ws, conn: psycopg.Connection, asset_id: int, *, dry_run: bool) -> int:
    count = 0
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row:
            continue
        amount = cell_amount(row[1])
        if amount is None:
            continue
        label = str(row[2] or "").strip() or None
        purpose = map_service_purpose(row[3])
        sub_bucket = map_service_sub_bucket(row[4])
        tx_date = cell_date(row[5])
        if not tx_date:
            continue
        if not dry_run:
            conn.execute(
                """
                INSERT INTO ledger_allocations (
                    asset_id, tx_date, amount, bucket, sub_bucket, label, purpose, source
                ) VALUES (%s, %s, %s, 'service', %s, %s, %s, 'ledger_import')
                """,
                (asset_id, tx_date, Decimal(str(amount)), sub_bucket, label, purpose),
            )
        count += 1
    return count


def import_car_consumables(ws, conn: psycopg.Connection, asset_id: int, *, dry_run: bool) -> int:
    count = 0
    col_indexes = [0, 1, 2, 3, 4, 5]
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row:
            continue
        month_date = cell_date(row[7]) if len(row) > 7 else None
        if not month_date:
            continue
        comment = str(row[8] or "").strip() if len(row) > 8 else None
        comment = comment or None
        for idx, (sub_bucket, _title) in enumerate(CAR_CONSUMABLE_COLUMNS):
            if idx >= len(col_indexes):
                break
            amount = cell_amount(row[col_indexes[idx]])
            if amount is None:
                continue
            if not dry_run:
                conn.execute(
                    """
                    INSERT INTO ledger_allocations (
                        asset_id, tx_date, amount, bucket, sub_bucket, label, source
                    ) VALUES (%s, %s, %s, 'consumables', %s, %s, 'ledger_import')
                    """,
                    (
                        asset_id,
                        month_date,
                        Decimal(str(amount)),
                        sub_bucket,
                        comment if idx == 0 else None,
                    ),
                )
            count += 1
    return count


def parse_maintenance_kind(code: str, label: str) -> str:
    code = str(code or "").strip().lower()
    label_l = label.lower()
    if code.endswith("b") or "коробк" in label_l:
        return "gearbox_oil"
    if code.endswith("a") or "мотор" in label_l:
        return "engine_oil"
    return "other"


def parse_odometer(raw: object) -> int | None:
    if isinstance(raw, (int, float)):
        return int(raw)
    s = str(raw or "")
    m = re.search(r"(\d{5,7})", s.replace(" ", ""))
    return int(m.group(1)) if m else None


def import_car_reminders(ws, conn: psycopg.Connection, asset_id: int, *, dry_run: bool) -> int:
    count = 0
    purchase_km = None
    current_km = None
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row:
            continue
        code = row[0]
        odo_raw = row[1]
        label = str(row[2] or "").strip()
        next_km = parse_odometer(row[3])
        done_date = cell_date(row[7]) if len(row) > 7 else None

        if not code and odo_raw and "покупке" in str(odo_raw):
            purchase_km = parse_odometer(odo_raw)
            continue

        if not label:
            continue
        odo = parse_odometer(odo_raw)
        if odo is None:
            continue
        if done_date is None:
            continue

        kind = parse_maintenance_kind(str(code or ""), label)
        current_km = max(current_km or 0, odo)

        if not dry_run:
            conn.execute(
                """
                INSERT INTO ledger_maintenance_events (
                    asset_id, kind, done_odometer_km, done_date, next_odometer_km, label, source
                ) VALUES (%s, %s, %s, %s, %s, %s, 'ledger_import')
                """,
                (asset_id, kind, odo, done_date, next_km, label),
            )
        count += 1

    if not dry_run and (purchase_km or current_km):
        conn.execute(
            """
            UPDATE ledger_assets
            SET purchase_odometer_km = COALESCE(%s, purchase_odometer_km),
                current_odometer_km = COALESCE(%s, current_odometer_km),
                updated_at = now()
            WHERE id = %s
            """,
            (purchase_km, current_km, asset_id),
        )
    return count


def run_import(path: Path, *, dry_run: bool, reset: bool) -> dict[str, int]:
    wb = openpyxl.load_workbook(path, data_only=True)
    stats = {"apartment": 0, "car_service": 0, "car_consumables": 0, "car_reminders": 0}

    with psycopg.connect(DATABASE_URL, row_factory=psycopg.rows.dict_row) as conn:
        apt_id = get_asset_id(conn, "sapronovo")
        car_id = get_asset_id(conn, "audi")

        if reset and not dry_run:
            clear_import_data(conn)

        stats["apartment"] = import_apartment(
            wb[SHEET_APARTMENT], conn, apt_id, dry_run=dry_run
        )
        stats["car_service"] = import_car_service(
            wb[SHEET_CAR_SERVICE], conn, car_id, dry_run=dry_run
        )
        stats["car_consumables"] = import_car_consumables(
            wb[SHEET_CAR_CONSUMABLES], conn, car_id, dry_run=dry_run
        )
        stats["car_reminders"] = import_car_reminders(
            wb[SHEET_CAR_REMINDERS], conn, car_id, dry_run=dry_run
        )

        if not dry_run:
            conn.commit()

    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description="Импорт Ledger.xlsx")
    parser.add_argument("path", type=Path, help="Путь к Ledger.xlsx")
    parser.add_argument("--dry-run", action="store_true", help="Без записи в БД")
    parser.add_argument("--reset", action="store_true", help="Удалить старый ledger_import")
    args = parser.parse_args()

    if not args.path.is_file():
        print(f"Файл не найден: {args.path}", file=sys.stderr)
        sys.exit(1)

    stats = run_import(args.path, dry_run=args.dry_run, reset=args.reset)
    mode = "dry-run" if args.dry_run else "imported"
    print(f"{mode}:", stats)


if __name__ == "__main__":
    main()
