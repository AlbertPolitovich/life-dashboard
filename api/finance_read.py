"""Чтение финансов: месяц, YTD, категории, транзакции, напоминания, план."""

from __future__ import annotations

from datetime import date
from typing import Any

import psycopg

from finance_common import (
    avg_median_income,
    build_expense_groups,
    build_income_payload,
    build_income_sources,
    category_by_id,
    category_by_slug,
    category_to_api,
    avg_monthly_assets_target,
    compute_assets_metrics,
    monthly_assets_series,
    ytd_through_month,
    completed_months_through,
    compute_balance_ytd,
    compute_food_pct,
    ensure_carryover_chain,
    expenses_from_sums,
    food_pct_history,
    food_share_history,
    food_status,
    FINANCE_EXPORT_CARRYOVER_SLUG,
    FINANCE_EXPORT_EXPENSE_SLUGS,
    FINANCE_EXPORT_INCOME_SLUGS,
    income_real_from_sums,
    load_categories,
    month_bounds,
    monthly_balance_series,
    monthly_income_real_series,
    next_reminder,
    upcoming_reminders,
    num,
    round_money,
    slug_amount,
    sum_by_category,
    transaction_to_api,
    year_bounds_through_month,
)


def build_finance_month_payload(
    conn: psycopg.Connection,
    year_month: str,
    today: date | None = None,
) -> dict[str, Any]:
    categories = load_categories(conn)
    if not categories:
        return {"ok": False, "error": "Справочник категорий пуст"}

    by_id = category_by_id(categories)
    by_slug = category_by_slug(categories)
    year = int(year_month[:4])
    month_num = int(year_month[5:7])

    ensure_carryover_chain(conn, year, categories)

    d_from, d_to = month_bounds(year_month)
    sums = sum_by_category(conn, d_from, d_to)

    income = build_income_payload(sums, categories, by_id)
    expenses_total = expenses_from_sums(sums, by_id)
    balance_month = round_money(income["real"] - expenses_total)
    balance_ytd = compute_balance_ytd(conn, year, month_num, categories)

    food_amount = slug_amount(sums, by_id, "eda") + slug_amount(sums, by_id, "kafe")
    food_pct = compute_food_pct(income["real"], food_amount)
    assets = compute_assets_metrics(sums, by_id, by_slug)

    groups = build_expense_groups(sums, categories)

    recent_balances = monthly_balance_series(conn, year, month_num, categories)
    last_four = recent_balances[-4:] if len(recent_balances) > 4 else recent_balances

    reminders = upcoming_reminders(conn, today=today)
    reminder = reminders[0] if reminders else None

    return {
        "ok": True,
        "month": year_month,
        "income": income,
        "expenses": {
            "total": round_money(expenses_total),
            "groups": groups,
        },
        "balanceMonth": balance_month,
        "balanceYtd": balance_ytd,
        "metrics": {
            "foodAmount": round_money(food_amount),
            "foodPct": food_pct,
            "foodStatus": food_status(food_pct),
            **assets,
        },
        "monthlyBalance": last_four,
        "widget": {
            "foodAmount": round_money(food_amount),
            "foodPct": food_pct,
            "foodStatus": food_status(food_pct),
            "nextReminder": reminder,
            "nextReminders": reminders,
        },
    }


def build_finance_ytd_payload(
    conn: psycopg.Connection,
    year: int,
    through_month: int | None = None,
) -> dict[str, Any]:
    categories = load_categories(conn)
    if not categories:
        return {"ok": False, "error": "Справочник категорий пуст"}

    by_id = category_by_id(categories)
    by_slug = category_by_slug(categories)
    through_month = ytd_through_month(year, through_month)

    ensure_carryover_chain(conn, year, categories)

    d_from, d_to = year_bounds_through_month(year, through_month)
    sums = sum_by_category(conn, d_from, d_to)

    income = build_income_payload(sums, categories, by_id)
    expenses_total = expenses_from_sums(sums, by_id)
    balance_ytd = round_money(income["carryover"] + income["real"] - expenses_total)

    monthly_income = monthly_income_real_series(conn, year, through_month, categories)
    stats_through_month = completed_months_through(year, through_month)
    monthly_income_stats = monthly_income_real_series(conn, year, stats_through_month, categories)
    avg_income, med_income, months_count = avg_median_income(monthly_income_stats)
    monthly_balance = monthly_balance_series(conn, year, through_month, categories)
    food_share = food_share_history(conn, year, through_month, categories)
    completed_food_share = food_share_history(conn, year, stats_through_month, categories, limit=12)
    completed_income = sum(num(r.get("incomeReal")) for r in completed_food_share)
    completed_food_core = sum(num(r.get("foodCoreAmount")) for r in completed_food_share)
    completed_food_cafe = sum(num(r.get("foodCafeAmount")) for r in completed_food_share)
    food_share_completed = {
        "corePct": compute_food_pct(completed_income, completed_food_core),
        "cafePct": compute_food_pct(completed_income, completed_food_cafe),
        "monthsCount": len(completed_food_share),
    }
    food_history = [
        {"month": r["month"], "pct": r["pctWithCafe"], "status": r["statusWithCafe"]}
        for r in food_share
    ]
    monthly_assets = monthly_assets_series(conn, year, through_month, categories)
    avg_assets_target = avg_monthly_assets_target(monthly_assets)

    assets_ytd = (
        compute_assets_metrics(sums, by_id, by_slug)
        if through_month > 0
        else {
            "assetsBase": 0.0,
            "assetsTarget": 0.0,
            "assetsActual": 0.0,
            "assetsGap": 0.0,
            "assetsGapPct": 0.0,
            "assetsBaseSources": [],
        }
    )

    income_sources = income["sources"]
    expense_groups = build_expense_groups(sums, categories)

    return {
        "ok": True,
        "year": year,
        "throughMonth": through_month,
        "balanceYtd": balance_ytd,
        "carryover": income["carryover"],
        "incomeRealTotal": income["real"],
        "expensesTotal": round_money(expenses_total),
        "income": income,
        "expenses": {
            "total": round_money(expenses_total),
            "groups": expense_groups,
        },
        "avgMonthlyIncome": avg_income,
        "medianMonthlyIncome": med_income,
        "monthsCount": months_count,
        "monthlyIncome": monthly_income,
        "monthlyBalance": monthly_balance,
        "foodPctHistory": food_history,
        "foodShareHistory": food_share,
        "foodShareCompleted": food_share_completed,
        "monthlyAssets": monthly_assets,
        "avgMonthlyAssetsTarget": avg_assets_target,
        "assetsYtd": assets_ytd,
        "assetsBreakdownYtd": assets_ytd["assetsBaseSources"],
    }


def list_finance_categories(
    conn: psycopg.Connection,
    kind: str | None = None,
) -> list[dict[str, Any]]:
    categories = load_categories(conn)
    if kind:
        categories = [c for c in categories if c["kind"] == kind]
    return [category_to_api(c) for c in categories]


def list_finance_transactions(
    conn: psycopg.Connection,
    year_month: str | None = None,
    category_id: int | None = None,
) -> list[dict[str, Any]]:
    clauses = ["1=1"]
    params: list[Any] = []
    if year_month:
        d_from, d_to = month_bounds(year_month)
        clauses.append("t.tx_date >= %s AND t.tx_date <= %s")
        params.extend([d_from, d_to])
    if category_id:
        clauses.append("t.category_id = %s")
        params.append(category_id)

    rows = conn.execute(
        f"""
        SELECT t.id, t.tx_date, t.category_id, t.amount, t.income_note, t.source, t.created_at,
               c.slug, c.name, c.kind
        FROM finance_transactions t
        JOIN finance_categories c ON c.id = t.category_id
        WHERE {' AND '.join(clauses)}
        ORDER BY t.tx_date DESC, t.id DESC
        """,
        params,
    ).fetchall()

    out: list[dict[str, Any]] = []
    for row in rows:
        cat = {
            "id": row["category_id"],
            "slug": row["slug"],
            "name": row["name"],
            "kind": row["kind"],
        }
        out.append(transaction_to_api(row, cat))
    return out


def list_finance_reminders(conn: psycopg.Connection) -> list[dict[str, Any]]:
    from finance_common import reminder_to_api

    rows = conn.execute(
        """
        SELECT r.id, r.day_of_month, r.due_date, r.label, r.amount_hint, r.is_active, r.category_id,
               c.slug AS category_slug, c.name AS category_name
        FROM finance_reminders r
        LEFT JOIN finance_categories c ON c.id = r.category_id
        ORDER BY r.day_of_month, r.id
        """
    ).fetchall()
    return [reminder_to_api(r) for r in rows]


def build_finance_plan_payload(conn: psycopg.Connection, year_month: str) -> dict[str, Any]:
    categories = load_categories(conn)
    d_from, d_to = month_bounds(year_month)
    fact_sums = sum_by_category(conn, d_from, d_to)

    plan_rows = conn.execute(
        """
        SELECT category_id, amount_planned
        FROM finance_monthly_plan
        WHERE year_month = %s
        """,
        (year_month,),
    ).fetchall()
    plan_by_cat = {int(r["category_id"]): num(r["amount_planned"]) for r in plan_rows}

    items: list[dict[str, Any]] = []
    plan_income = 0.0
    plan_expense = 0.0
    fact_income = 0.0
    fact_expense = 0.0

    for cat in categories:
        if cat["kind"] == "carryover":
            continue
        cid = int(cat["id"])
        planned = round_money(plan_by_cat.get(cid, 0.0))
        fact = round_money(fact_sums.get(cid, 0.0))
        if planned <= 0 and fact <= 0 and cid not in plan_by_cat:
            continue
        items.append(
            {
                "categoryId": cid,
                "slug": cat["slug"],
                "name": cat["name"],
                "kind": cat["kind"],
                "groupName": cat["group_name"],
                "amountPlanned": planned,
                "amountFact": fact,
            }
        )
        if cat["kind"] == "income":
            plan_income += planned
            fact_income += fact
        elif cat["kind"] == "expense":
            plan_expense += planned
            fact_expense += fact

    items.sort(key=lambda x: (x["kind"], x.get("groupName") or "", -x["amountPlanned"], x["name"]))

    return {
        "ok": True,
        "month": year_month,
        "planIncomeTotal": round_money(plan_income),
        "planExpenseTotal": round_money(plan_expense),
        "factIncomeTotal": round_money(fact_income),
        "factExpenseTotal": round_money(fact_expense),
        "planOverBudget": plan_expense > plan_income and plan_income > 0,
        "items": items,
    }


FINANCE_EXPORT_PERIODS = frozenset({"year", "period", "custom"})


def resolve_finance_export_bounds(
    period: str,
    date_from: str | None = None,
    date_to: str | None = None,
    today: date | None = None,
) -> tuple[date, date, str]:
    ref = today or date.today()
    p = period.strip().lower()
    if p == "year":
        d_from = date(ref.year, 1, 1)
        d_to = ref
        label = str(ref.year)
    elif p in {"period", "custom"}:
        if not date_from or not date_to:
            raise ValueError("from и to обязательны для period=period")
        d_from = date.fromisoformat(date_from)
        d_to = date.fromisoformat(date_to)
        if d_from > d_to:
            raise ValueError("from не может быть позже to")
        label = f"{date_from}_{date_to}"
    else:
        raise ValueError("period: year или period")
    return d_from, d_to, label


def sums_by_slug(
    conn: psycopg.Connection,
    date_from: date,
    date_to: date,
) -> dict[str, float]:
    rows = conn.execute(
        """
        SELECT c.slug, COALESCE(SUM(t.amount), 0) AS total
        FROM finance_categories c
        LEFT JOIN finance_transactions t
          ON t.category_id = c.id
         AND t.tx_date >= %s AND t.tx_date <= %s
        GROUP BY c.slug
        """,
        (date_from, date_to),
    ).fetchall()
    return {str(r["slug"]): round_money(num(r["total"])) for r in rows}


def monthly_sums_by_slug(
    conn: psycopg.Connection,
    year: int,
    through_month: int,
) -> dict[str, dict[int, float]]:
    rows = conn.execute(
        """
        SELECT c.slug, EXTRACT(MONTH FROM t.tx_date)::int AS month_num, COALESCE(SUM(t.amount), 0) AS total
        FROM finance_transactions t
        JOIN finance_categories c ON c.id = t.category_id
        WHERE EXTRACT(YEAR FROM t.tx_date)::int = %s
          AND EXTRACT(MONTH FROM t.tx_date)::int <= %s
        GROUP BY c.slug, month_num
        ORDER BY c.slug, month_num
        """,
        (year, through_month),
    ).fetchall()
    out: dict[str, dict[int, float]] = {}
    for row in rows:
        slug = str(row["slug"])
        month_num = int(row["month_num"])
        out.setdefault(slug, {})[month_num] = round_money(num(row["total"]))
    return out


def csv_rub(amount: float) -> int:
    return int(round_money(amount))


def build_finance_export_rows(
    conn: psycopg.Connection,
    period: str,
    date_from: str | None = None,
    date_to: str | None = None,
    today: date | None = None,
) -> tuple[list[list[Any]], str]:
    d_from, d_to, label = resolve_finance_export_bounds(period, date_from, date_to, today)
    categories = load_categories(conn)
    by_slug = category_by_slug(categories)
    totals = sums_by_slug(conn, d_from, d_to)

    def amount_for(slug: str) -> float:
        return totals.get(slug, 0.0)

    def name_for(slug: str) -> str:
        cat = by_slug.get(slug)
        return str(cat["name"]) if cat else slug

    income_sum = sum(amount_for(s) for s in FINANCE_EXPORT_INCOME_SLUGS)
    carryover = amount_for(FINANCE_EXPORT_CARRYOVER_SLUG)
    expense_sum = sum(amount_for(s) for s in FINANCE_EXPORT_EXPENSE_SLUGS)
    balance = round_money(income_sum + carryover - expense_sum)

    rows: list[list[Any]] = [
        ["период с", d_from.isoformat()],
        ["период по", d_to.isoformat()],
        [],
    ]
    for slug in FINANCE_EXPORT_INCOME_SLUGS:
        rows.append([name_for(slug), csv_rub(amount_for(slug))])
    rows.append(["Сумма доходов", csv_rub(income_sum)])
    rows.append([name_for(FINANCE_EXPORT_CARRYOVER_SLUG), csv_rub(carryover)])
    rows.append([])
    for slug in FINANCE_EXPORT_EXPENSE_SLUGS:
        rows.append([name_for(slug), csv_rub(amount_for(slug))])
    rows.append(["Сумма расходов", csv_rub(expense_sum)])
    rows.append(["Баланс", csv_rub(balance)])
    return rows, label


def build_finance_export_rows_year_monthly(
    conn: psycopg.Connection,
    today: date | None = None,
) -> tuple[list[list[Any]], str]:
    ref = today or date.today()
    year = ref.year
    through_month = ref.month
    month_names = [
        "янв",
        "фев",
        "мар",
        "апр",
        "май",
        "июн",
        "июл",
        "авг",
        "сен",
        "окт",
        "ноя",
        "дек",
    ]
    months = list(range(1, through_month + 1))
    header = ["Категория", *[month_names[m - 1] for m in months]]

    categories = load_categories(conn)
    by_slug = category_by_slug(categories)
    monthly = monthly_sums_by_slug(conn, year, through_month)

    def amount_for(slug: str, month_num: int) -> float:
        return monthly.get(slug, {}).get(month_num, 0.0)

    def row_for(slug: str) -> list[Any]:
        cat = by_slug.get(slug)
        name = str(cat["name"]) if cat else slug
        return [name, *[csv_rub(amount_for(slug, m)) for m in months]]

    income_totals = [
        round_money(sum(amount_for(slug, m) for slug in FINANCE_EXPORT_INCOME_SLUGS))
        for m in months
    ]
    carryover_totals = [round_money(amount_for(FINANCE_EXPORT_CARRYOVER_SLUG, m)) for m in months]
    expense_totals = [
        round_money(sum(amount_for(slug, m) for slug in FINANCE_EXPORT_EXPENSE_SLUGS))
        for m in months
    ]
    balance_totals = [
        round_money(income_totals[i] + carryover_totals[i] - expense_totals[i])
        for i in range(len(months))
    ]

    rows: list[list[Any]] = [header]
    for slug in FINANCE_EXPORT_INCOME_SLUGS:
        rows.append(row_for(slug))
    rows.append(["Сумма доходов", *[csv_rub(v) for v in income_totals]])
    rows.append(row_for(FINANCE_EXPORT_CARRYOVER_SLUG))
    rows.append([])
    for slug in FINANCE_EXPORT_EXPENSE_SLUGS:
        rows.append(row_for(slug))
    rows.append(["Сумма расходов", *[csv_rub(v) for v in expense_totals]])
    rows.append(["Баланс", *[csv_rub(v) for v in balance_totals]])
    return rows, str(year)


def build_finance_export_xlsx(
    conn: psycopg.Connection,
    period: str,
    date_from: str | None = None,
    date_to: str | None = None,
    today: date | None = None,
) -> tuple[bytes, str]:
    from io import BytesIO

    from openpyxl import Workbook

    p = period.strip().lower()
    if p == "year":
        rows, label = build_finance_export_rows_year_monthly(conn, today=today)
    else:
        rows, label = build_finance_export_rows(conn, p, date_from, date_to, today)
    wb = Workbook()
    ws = wb.active
    ws.title = "Финансы"
    for row in rows:
        ws.append(row)
    ws.column_dimensions["A"].width = 30
    for col in range(2, 14):
        ws.column_dimensions[chr(ord("A") + col - 1)].width = 14
    bio = BytesIO()
    wb.save(bio)
    return bio.getvalue(), label
