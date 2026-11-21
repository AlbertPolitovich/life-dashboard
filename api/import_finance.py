#!/usr/bin/env python3
"""
Импорт Finance.xlsx → finance_transactions (факт) + finance_monthly_plan (план июня).

Факт: январь–июнь, дата = последний день месяца, source = excel_import.
Остаток: январь, категория carryover.
План: только 2026-06 (правый блок Excel, колонка June).

Примеры:
  python import_finance.py "/Users/artem/Downloads/Finance.xlsx"
  python import_finance.py Finance.xlsx --dry-run
  python import_finance.py Finance.xlsx --month 2026-06
"""

from __future__ import annotations

from datetime import date

import argparse
import os
import re
import sys
import unicodedata
from decimal import Decimal
from pathlib import Path

import openpyxl
import psycopg
from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))

from finance_common import month_bounds, month_last_day  # noqa: E402

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://life:life@localhost:5432/life_dashboard",
).strip()

# Левая таблица: факт по месяцам (колонка Excel → yyyy-MM)
FACT_COL_MONTH = {
    3: "2026-01",
    4: "2026-02",
    5: "2026-03",
    6: "2026-04",
    7: "2026-05",
    8: "2026-06",
}

# Правый блок: план только июнь
PLAN_COL_MONTH = {
    24: "2026-06",
}

INCOME_ROW_START = 3
INCOME_ROW_END = 8
EXPENSE_ROW_START = 14
EXPENSE_ROW_END = 38

SKIP_LABELS = frozenset(
    {
        "total",
        "balance",
        "incomes",
        "expenses",
        "future total",
        "incomes ",
        "expenses ",
    }
)

EXCEL_NAME_TO_SLUG: dict[str, str] = {
    "дарья фото": "darya_photo",
    "дарья оклад": "darya_salary",
    "артем оклад": "artem_salary",
    "артём оклад": "artem_salary",
    "артем bonus": "artem_bonus",
    "артем бонус": "artem_bonus",
    "артём бонус": "artem_bonus",
    "прочее": "other",
    "остаток": "carryover",
    "активы 10% (инвестиции)": "assets_10",
    "кварплата": "kvartplata",
    "еда": "eda",
    "кафе и рестораны": "kafe",
    "проезд": "proezd",
    "такси и каршеринг": "taksi",
    "связь": "svyaz",
    "интернет подписки": "internet",
    "автомобиль": "avto",
    "красота и стрижки": "krasota",
    "развлечения": "razvlecheniya",
    "спорт": "sport",
    "налоги": "nalogi",
    "продвижение и бизнес": "biznes",
    "ребенок": "rebenok",
    "ребёнок": "rebenok",
    "одежда": "odezhda",
    "здоровье": "zdorovie",
    "для дома (ремонт)": "dom_remont",
    "техника": "technika",
    "подарки": "podarki",
    "отпуск": "otpusk",
    "обучение": "obuchenie",
    "разное": "raznoe",
    "ипотека": "ipoteka",
    "накопления даша": "nakopleniya_dasha",
}


def normalize_label(text: str) -> str:
    s = unicodedata.normalize("NFC", (text or "").strip().lower())
    s = s.replace("ё", "е")
    s = re.sub(r"\s+", " ", s)
    return s


def parse_amount(value) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        v = float(value)
        return v if v > 0 else None
    s = str(value).strip().replace(",", ".").replace(" ", "").replace("₽", "")
    if not s:
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return v if v > 0 else None


def load_slug_map(conn: psycopg.Connection) -> dict[str, int]:
    rows = conn.execute("SELECT id, slug FROM finance_categories").fetchall()
    return {str(r["slug"]): int(r["id"]) for r in rows}


def clear_excel_month(conn: psycopg.Connection, year_month: str) -> tuple[int, int]:
    d_from, d_to = month_bounds(year_month)
    deleted_tx = conn.execute(
        """
        DELETE FROM finance_transactions
        WHERE source = 'excel_import'
          AND tx_date >= %s AND tx_date <= %s
        """,
        (d_from, d_to),
    ).rowcount
    deleted_plan = conn.execute(
        "DELETE FROM finance_monthly_plan WHERE year_month = %s",
        (year_month,),
    ).rowcount
    return deleted_tx, deleted_plan


def read_sheet(path: Path):
    wb = openpyxl.load_workbook(path, data_only=True)
    return wb.active


def collect_facts(
    ws,
    months: set[str],
    plan_months: set[str],
) -> tuple[list[dict], list[dict]]:
    facts: list[dict] = []
    col_for_month = {col: m for col, m in FACT_COL_MONTH.items() if m in months}
    plan_col_for_month = {
        col: m for col, m in PLAN_COL_MONTH.items() if m in plan_months
    }

    for row_idx in range(INCOME_ROW_START, INCOME_ROW_END + 1):
        label = ws.cell(row_idx, 2).value
        if not label:
            continue
        norm = normalize_label(str(label))
        if norm in SKIP_LABELS:
            continue
        slug = EXCEL_NAME_TO_SLUG.get(norm)
        if not slug:
            print(f"  пропуск дохода (неизвестное имя): {label}", file=sys.stderr)
            continue
        for col, ym in col_for_month.items():
            amount = parse_amount(ws.cell(row_idx, col).value)
            if amount is None:
                continue
            facts.append({"year_month": ym, "slug": slug, "amount": amount})

    for row_idx in range(EXPENSE_ROW_START, EXPENSE_ROW_END + 1):
        label = ws.cell(row_idx, 2).value
        if not label:
            continue
        norm = normalize_label(str(label))
        if norm in SKIP_LABELS:
            continue
        slug = EXCEL_NAME_TO_SLUG.get(norm)
        if not slug:
            print(f"  пропуск расхода (неизвестное имя): {label}", file=sys.stderr)
            continue
        for col, ym in col_for_month.items():
            amount = parse_amount(ws.cell(row_idx, col).value)
            if amount is None:
                continue
            facts.append({"year_month": ym, "slug": slug, "amount": amount})

    plans: list[dict] = []
    for row_idx in range(INCOME_ROW_START, EXPENSE_ROW_END + 1):
        label = ws.cell(row_idx, 18).value
        if not label:
            continue
        norm = normalize_label(str(label))
        if norm in SKIP_LABELS or norm in ("incomes", "expenses"):
            continue
        slug = EXCEL_NAME_TO_SLUG.get(norm)
        if not slug:
            continue
        for col, ym in plan_col_for_month.items():
            amount = parse_amount(ws.cell(row_idx, col).value)
            if amount is None:
                continue
            plans.append({"year_month": ym, "slug": slug, "amount": amount})

    return facts, plans


def insert_facts(
    conn: psycopg.Connection,
    facts: list[dict],
    slug_to_id: dict[str, int],
    dry_run: bool,
) -> int:
    written = 0
    for item in facts:
        cid = slug_to_id.get(item["slug"])
        if not cid:
            print(f"  нет категории slug={item['slug']}", file=sys.stderr)
            continue
        tx_date = month_last_day(item["year_month"])
        today = date.today()
        if tx_date > today:
            tx_date = today
        if dry_run:
            written += 1
            continue
        conn.execute(
            """
            INSERT INTO finance_transactions (tx_date, category_id, amount, source)
            VALUES (%s, %s, %s, 'excel_import')
            """,
            (tx_date, cid, Decimal(str(item["amount"]))),
        )
        written += 1
    return written


def insert_plans(
    conn: psycopg.Connection,
    plans: list[dict],
    slug_to_id: dict[str, int],
    dry_run: bool,
) -> int:
    written = 0
    for item in plans:
        cid = slug_to_id.get(item["slug"])
        if not cid:
            continue
        if dry_run:
            written += 1
            continue
        conn.execute(
            """
            INSERT INTO finance_monthly_plan (year_month, category_id, amount_planned, updated_at)
            VALUES (%s, %s, %s, now())
            ON CONFLICT (year_month, category_id)
            DO UPDATE SET amount_planned = EXCLUDED.amount_planned, updated_at = now()
            """,
            (item["year_month"], cid, Decimal(str(item["amount"]))),
        )
        written += 1
    return written


def main() -> int:
    parser = argparse.ArgumentParser(description="Импорт Finance.xlsx")
    parser.add_argument("xlsx", type=Path, help="Путь к Finance.xlsx")
    parser.add_argument("--dry-run", action="store_true", help="Без записи в БД")
    parser.add_argument(
        "--month",
        metavar="YYYY-MM",
        help="Перезалить факт и план только за этот месяц (удаляет excel_import за месяц)",
    )
    parser.add_argument(
        "--facts-only",
        action="store_true",
        help="Не импортировать план",
    )
    args = parser.parse_args()

    if not args.xlsx.is_file():
        print(f"Файл не найден: {args.xlsx}", file=sys.stderr)
        return 1

    if args.month:
        months = {args.month.strip()}
    else:
        months = set(FACT_COL_MONTH.values())

    plan_months = set() if args.facts_only else ({args.month} if args.month else {"2026-06"})

    ws = read_sheet(args.xlsx)
    facts, plans = collect_facts(ws, months, plan_months)

    print(f"Факт: {len(facts)} ячеек, план: {len(plans)} ячеек")

    with psycopg.connect(DATABASE_URL, row_factory=psycopg.rows.dict_row) as conn:
        slug_to_id = load_slug_map(conn)
        if not slug_to_id:
            print("Справочник finance_categories пуст — сначала примените миграцию 003", file=sys.stderr)
            return 1

        if args.month and not args.dry_run:
            deleted_tx, deleted_plan = clear_excel_month(conn, args.month)
            print(f"Очищено за {args.month}: транзакций excel_import={deleted_tx}, план={deleted_plan}")

        n_facts = insert_facts(conn, facts, slug_to_id, args.dry_run)
        n_plans = insert_plans(conn, plans, slug_to_id, args.dry_run)

        if not args.dry_run:
            conn.commit()

    print(f"Записано: факт={n_facts}, план={n_plans}" + (" (dry-run)" if args.dry_run else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
