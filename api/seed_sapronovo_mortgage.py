#!/usr/bin/env python3
"""
Сид ипотеки Сапроново: конфиг, график из PDF, доп. allocations ремонта.

  python seed_sapronovo_mortgage.py "/Users/artem/Downloads/График+платежей (1).pdf"
  python seed_sapronovo_mortgage.py --dry-run
"""

from __future__ import annotations

import argparse
import os
import sys
from decimal import Decimal
from pathlib import Path

import psycopg
from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))

from mortgage_schedule_parse import parse_mortgage_schedule_pdf  # noqa: E402

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://life:life@localhost:5432/life_dashboard",
).strip()

DEFAULT_PDF = Path("/Users/artem/Downloads/График+платежей (1).pdf")

REPAIR_SEEDS = (
    (73400.0, "кухня 2 платеж"),
    (33254.0, "кондиционеры"),
)

MORTGAGE_PAYMENT_SEEDS = (
    ("2026-06-15", 64000.0, "платеж по ипотеке"),
)

MORTGAGE_CONFIG = {
    "principal_initial": Decimal("10595423.00"),
    "down_payment": Decimal("1978565.00"),
    "annual_rate_pct": Decimal("18.698"),
    "monthly_payment": Decimal("63524.91"),
    "loan_start_date": "2025-12-15",
    # Сверка с приложением банка (остаток долга на дату)
    "principal_remaining_override": Decimal("10535652.52"),
    "principal_remaining_as_of": "2026-06-18",
}


def get_asset_id(conn: psycopg.Connection, slug: str) -> int:
    row = conn.execute("SELECT id FROM ledger_assets WHERE slug = %s", (slug,)).fetchone()
    if not row:
        raise RuntimeError(f"Объект {slug} не найден")
    return int(row["id"])


def seed_config(conn: psycopg.Connection, asset_id: int, *, dry_run: bool) -> None:
    if dry_run:
        print("config: skip (dry-run)")
        return
    conn.execute(
        """
        INSERT INTO ledger_mortgage_config (
            asset_id, principal_initial, down_payment, annual_rate_pct,
            monthly_payment, loan_start_date, extra_payments_json,
            principal_remaining_override, principal_remaining_as_of, updated_at
        )
        VALUES (%s, %s, %s, %s, %s, %s::date, '[]'::jsonb, %s, %s::date, now())
        ON CONFLICT (asset_id) DO UPDATE SET
            principal_initial = EXCLUDED.principal_initial,
            down_payment = EXCLUDED.down_payment,
            annual_rate_pct = EXCLUDED.annual_rate_pct,
            monthly_payment = EXCLUDED.monthly_payment,
            loan_start_date = EXCLUDED.loan_start_date,
            principal_remaining_override = EXCLUDED.principal_remaining_override,
            principal_remaining_as_of = EXCLUDED.principal_remaining_as_of,
            updated_at = now()
        """,
        (
            asset_id,
            MORTGAGE_CONFIG["principal_initial"],
            MORTGAGE_CONFIG["down_payment"],
            MORTGAGE_CONFIG["annual_rate_pct"],
            MORTGAGE_CONFIG["monthly_payment"],
            MORTGAGE_CONFIG["loan_start_date"],
            MORTGAGE_CONFIG["principal_remaining_override"],
            MORTGAGE_CONFIG["principal_remaining_as_of"],
        ),
    )


def seed_mortgage_payments(conn: psycopg.Connection, asset_id: int, *, dry_run: bool) -> None:
    for tx_date, amount, label in MORTGAGE_PAYMENT_SEEDS:
        exists = conn.execute(
            """
            SELECT 1 FROM ledger_allocations
            WHERE asset_id = %s AND bucket = 'mortgage' AND tx_date = %s::date
              AND label = %s AND amount = %s
            LIMIT 1
            """,
            (asset_id, tx_date, label, Decimal(str(amount))),
        ).fetchone()
        if exists:
            print(f"mortgage: уже есть {tx_date} · {amount:.0f}")
            continue
        print(f"mortgage: +{amount:.0f} «{label}» · {tx_date}")
        if dry_run:
            continue
        conn.execute(
            """
            INSERT INTO ledger_allocations (asset_id, tx_date, amount, bucket, label, source)
            VALUES (%s, %s::date, %s, 'mortgage', %s, 'manual')
            """,
            (asset_id, tx_date, Decimal(str(amount)), label),
        )


def seed_schedule(
    conn: psycopg.Connection,
    asset_id: int,
    schedule: list[dict[str, object]],
    *,
    dry_run: bool,
) -> None:
    print(f"schedule: {len(schedule)} строк")
    if dry_run:
        return
    conn.execute("DELETE FROM ledger_mortgage_schedule WHERE asset_id = %s", (asset_id,))
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO ledger_mortgage_schedule (
                asset_id, payment_no, due_date, payment_total,
                principal_part, interest_part, balance_after
            )
            VALUES (%s, %s, %s::date, %s, %s, %s, %s)
            """,
            [
                (
                    asset_id,
                    row["paymentNo"],
                    row["dueDate"],
                    Decimal(str(row["paymentTotal"])),
                    Decimal(str(row["principalPart"])),
                    Decimal(str(row["interestPart"])),
                    Decimal(str(row["balanceAfter"])),
                )
                for row in schedule
            ],
        )


def seed_repair_allocations(conn: psycopg.Connection, asset_id: int, *, dry_run: bool) -> None:
    for amount, label in REPAIR_SEEDS:
        exists = conn.execute(
            """
            SELECT 1 FROM ledger_allocations
            WHERE asset_id = %s AND bucket = 'repair' AND label = %s
            LIMIT 1
            """,
            (asset_id, label),
        ).fetchone()
        if exists:
            print(f"repair: уже есть «{label}»")
            continue
        print(f"repair: +{amount:.0f} «{label}»")
        if dry_run:
            continue
        conn.execute(
            """
            INSERT INTO ledger_allocations (asset_id, tx_date, amount, bucket, label, source)
            VALUES (%s, CURRENT_DATE, %s, 'repair', %s, 'manual')
            """,
            (asset_id, Decimal(str(amount)), label),
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", nargs="?", default=str(DEFAULT_PDF))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    pdf_path = Path(args.pdf)
    if not pdf_path.is_file():
        print(f"PDF не найден: {pdf_path}", file=sys.stderr)
        return 1

    schedule = parse_mortgage_schedule_pdf(pdf_path)
    if len(schedule) < 300:
        print(f"Предупреждение: мало строк графика ({len(schedule)})", file=sys.stderr)

    with psycopg.connect(DATABASE_URL, row_factory=psycopg.rows.dict_row) as conn:
        asset_id = get_asset_id(conn, "sapronovo")
        seed_config(conn, asset_id, dry_run=args.dry_run)
        seed_schedule(conn, asset_id, schedule, dry_run=args.dry_run)
        seed_mortgage_payments(conn, asset_id, dry_run=args.dry_run)
        seed_repair_allocations(conn, asset_id, dry_run=args.dry_run)
        if not args.dry_run:
            conn.commit()
    print("Готово")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
