"""Общие константы и агрегаты финансов."""

from __future__ import annotations

import calendar
from datetime import date
from decimal import Decimal
from statistics import median
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import psycopg

ASSETS_BASE_SOURCE_ORDER = ("darya_photo", "artem_salary", "artem_bonus")
FOOD_SLUGS = frozenset({"eda", "kafe"})
ASSETS_ACTUAL_SLUG = "assets_10"

# Порядок строк в CSV-выгрузке — как левая таблица Finance.xlsx
FINANCE_EXPORT_INCOME_SLUGS = (
    "darya_photo",
    "darya_salary",
    "artem_salary",
    "artem_bonus",
    "other",
)
FINANCE_EXPORT_CARRYOVER_SLUG = "carryover"
CARRYOVER_AUTO_SOURCE = "carryover_auto"
FINANCE_EXPORT_EXPENSE_SLUGS = (
    "assets_10",
    "kvartplata",
    "eda",
    "kafe",
    "proezd",
    "taksi",
    "svyaz",
    "internet",
    "avto",
    "krasota",
    "razvlecheniya",
    "sport",
    "nalogi",
    "biznes",
    "rebenok",
    "odezhda",
    "zdorovie",
    "dom_remont",
    "technika",
    "podarki",
    "otpusk",
    "obuchenie",
    "raznoe",
    "ipoteka",
    "nakopleniya_dasha",
)

GROUP_ORDER = (
    "Обязательные",
    "Питание",
    "Транспорт",
    "Дом",
    "Семья",
    "Здоровье/спорт",
    "Развитие",
    "Активы",
)


def parse_positive_amount(raw: Any) -> float | None:
    if raw is None:
        return None
    s = str(raw).strip().replace(",", ".").replace(" ", "")
    if not s:
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    if v <= 0:
        return None
    return v


def num(v: Any) -> float:
    if v is None:
        return 0.0
    if isinstance(v, Decimal):
        return float(v)
    return float(v)


def round_money(v: float) -> float:
    return round(v, 2)


def month_bounds(year_month: str) -> tuple[date, date]:
    y, m = map(int, year_month.split("-"))
    last = calendar.monthrange(y, m)[1]
    return date(y, m, 1), date(y, m, last)


def month_last_day(year_month: str) -> date:
    return month_bounds(year_month)[1]


def year_bounds_through_month(year: int, through_month: int) -> tuple[date, date]:
    return date(year, 1, 1), date(year, through_month, calendar.monthrange(year, through_month)[1])


def food_status(pct: float) -> str:
    if pct <= 25:
        return "ok"
    if pct <= 35:
        return "warn"
    return "bad"


def load_categories(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return conn.execute(
        """
        SELECT id, slug, name, kind, group_name, color_key, is_fixed, is_system, sort_order
        FROM finance_categories
        ORDER BY sort_order, id
        """
    ).fetchall()


def category_by_slug(categories: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(c["slug"]): c for c in categories}


def category_by_id(categories: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    return {int(c["id"]): c for c in categories}


def sum_by_category(
    conn: psycopg.Connection,
    date_from: date,
    date_to: date,
) -> dict[int, float]:
    rows = conn.execute(
        """
        SELECT category_id, COALESCE(SUM(amount), 0) AS total
        FROM finance_transactions
        WHERE tx_date >= %s AND tx_date <= %s
        GROUP BY category_id
        """,
        (date_from, date_to),
    ).fetchall()
    return {int(r["category_id"]): num(r["total"]) for r in rows}


def income_real_from_sums(
    sums: dict[int, float],
    by_id: dict[int, dict[str, Any]],
) -> float:
    total = 0.0
    for cid, amount in sums.items():
        cat = by_id.get(cid)
        if cat and cat["kind"] == "income":
            total += amount
    return total


def expenses_from_sums(
    sums: dict[int, float],
    by_id: dict[int, dict[str, Any]],
) -> float:
    total = 0.0
    for cid, amount in sums.items():
        cat = by_id.get(cid)
        if cat and cat["kind"] == "expense":
            total += amount
    return total


def carryover_from_sums(
    sums: dict[int, float],
    by_id: dict[int, dict[str, Any]],
) -> float:
    total = 0.0
    for cid, amount in sums.items():
        cat = by_id.get(cid)
        if cat and cat["kind"] == "carryover":
            total += amount
    return total


def slug_amount(sums: dict[int, float], by_id: dict[int, dict[str, Any]], slug: str) -> float:
    for cid, amount in sums.items():
        cat = by_id.get(cid)
        if cat and cat["slug"] == slug:
            return amount
    return 0.0


def compute_food_pct(income_real: float, food_amount: float) -> float:
    if income_real <= 0:
        return 0.0
    return round_money(food_amount / income_real * 100)


def compute_assets_metrics(
    sums: dict[int, float],
    by_id: dict[int, dict[str, Any]],
    by_slug: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    base = 0.0
    sources: list[dict[str, Any]] = []
    for slug in ASSETS_BASE_SOURCE_ORDER:
        cat = by_slug.get(slug)
        amount = sums.get(int(cat["id"]), 0.0) if cat else 0.0
        base += amount
        sources.append(
            {
                "slug": slug,
                "name": cat["name"] if cat else slug,
                "amount": round_money(amount),
            }
        )
    target = round_money(base * 0.10)
    actual_cat = by_slug.get(ASSETS_ACTUAL_SLUG)
    actual = sums.get(int(actual_cat["id"]), 0.0) if actual_cat else 0.0
    gap = round_money(target - actual)
    gap_pct = round_money(gap / target * 100) if target > 0 else 0.0
    return {
        "assetsBase": round_money(base),
        "assetsTarget": target,
        "assetsActual": round_money(actual),
        "assetsGap": gap,
        "assetsGapPct": gap_pct,
        "assetsBaseSources": sources,
    }


def build_income_payload(
    sums: dict[int, float],
    categories: list[dict[str, Any]],
    by_id: dict[int, dict[str, Any]],
) -> dict[str, Any]:
    income_real = income_real_from_sums(sums, by_id)
    carryover = round_money(slug_amount(sums, by_id, FINANCE_EXPORT_CARRYOVER_SLUG))
    return {
        "real": round_money(income_real),
        "carryover": carryover,
        "total": round_money(income_real + carryover),
        "sources": build_income_sources(sums, categories),
    }


def finance_min_year(conn: psycopg.Connection) -> int | None:
    row = conn.execute(
        "SELECT EXTRACT(YEAR FROM MIN(tx_date))::int AS y FROM finance_transactions"
    ).fetchone()
    if not row or row["y"] is None:
        return None
    return int(row["y"])


def ensure_carryover_chain(
    conn: psycopg.Connection,
    through_year: int,
    categories: list[dict[str, Any]],
) -> None:
    """Перенос balance YTD прошлого года в «Остаток» января (carryover_auto)."""
    by_slug = category_by_slug(categories)
    carryover_cat = by_slug.get(FINANCE_EXPORT_CARRYOVER_SLUG)
    if not carryover_cat:
        return

    min_year = finance_min_year(conn)
    if min_year is None or through_year <= min_year:
        return

    carryover_cat_id = int(carryover_cat["id"])
    has_auto = conn.execute(
        "SELECT 1 FROM finance_transactions WHERE source = %s LIMIT 1",
        (CARRYOVER_AUTO_SOURCE,),
    ).fetchone()
    if has_auto:
        years = [through_year]
    else:
        years = list(range(min_year + 1, through_year + 1))

    changed = False
    for year in years:
        if year <= min_year:
            continue
        if _ensure_january_carryover(conn, year, carryover_cat_id, categories):
            changed = True
    if changed:
        conn.commit()


def _ensure_january_carryover(
    conn: psycopg.Connection,
    year: int,
    carryover_cat_id: int,
    categories: list[dict[str, Any]],
) -> bool:
    prev_balance = compute_balance_ytd(conn, year - 1, 12, categories)
    target = round_money(prev_balance)
    jan_ym = f"{year:04d}-01"
    d_from, d_to = month_bounds(jan_ym)
    tx_date = month_last_day(jan_ym)

    rows = conn.execute(
        """
        SELECT id, amount, source
        FROM finance_transactions
        WHERE category_id = %s AND tx_date >= %s AND tx_date <= %s
        ORDER BY id
        """,
        (carryover_cat_id, d_from, d_to),
    ).fetchall()

    if target == 0:
        deleted = False
        for row in rows:
            if row["source"] == CARRYOVER_AUTO_SOURCE:
                conn.execute("DELETE FROM finance_transactions WHERE id = %s", (int(row["id"]),))
                deleted = True
        return deleted

    if rows:
        keep_id = int(rows[0]["id"])
        changed = num(rows[0]["amount"]) != target or rows[0]["source"] != CARRYOVER_AUTO_SOURCE
        if changed:
            conn.execute(
                """
                UPDATE finance_transactions
                SET amount = %s, source = %s, tx_date = %s
                WHERE id = %s
                """,
                (Decimal(str(target)), CARRYOVER_AUTO_SOURCE, tx_date, keep_id),
            )
        for row in rows[1:]:
            conn.execute("DELETE FROM finance_transactions WHERE id = %s", (int(row["id"]),))
            changed = True
        return changed

    conn.execute(
        """
        INSERT INTO finance_transactions (tx_date, category_id, amount, income_note, source)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (
            tx_date,
            carryover_cat_id,
            Decimal(str(target)),
            f"остаток {year - 1}",
            CARRYOVER_AUTO_SOURCE,
        ),
    )
    return True


def build_income_sources(
    sums: dict[int, float],
    categories: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    sources: list[dict[str, Any]] = []
    for cat in categories:
        if cat["kind"] != "income":
            continue
        amount = sums.get(int(cat["id"]), 0.0)
        if amount <= 0:
            continue
        sources.append(
            {
                "categoryId": int(cat["id"]),
                "slug": cat["slug"],
                "name": cat["name"],
                "amount": round_money(amount),
            }
        )
    sources.sort(key=lambda x: (-x["amount"], x["name"]))
    return sources


def build_expense_groups(
    sums: dict[int, float],
    categories: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for cat in categories:
        if cat["kind"] != "expense":
            continue
        amount = sums.get(int(cat["id"]), 0.0)
        if amount <= 0:
            continue
        gname = cat["group_name"] or "Прочее"
        if gname not in grouped:
            grouped[gname] = {
                "group": gname,
                "colorKey": cat["color_key"],
                "total": 0.0,
                "categories": [],
            }
        grouped[gname]["total"] += amount
        grouped[gname]["categories"].append(
            {
                "categoryId": int(cat["id"]),
                "slug": cat["slug"],
                "name": cat["name"],
                "amount": round_money(amount),
            }
        )

    groups: list[dict[str, Any]] = []
    for gname in GROUP_ORDER:
        if gname not in grouped:
            continue
        g = grouped.pop(gname)
        g["total"] = round_money(g["total"])
        g["categories"].sort(key=lambda x: (-x["amount"], x["name"]))
        groups.append(g)
    for gname in sorted(grouped.keys()):
        g = grouped[gname]
        g["total"] = round_money(g["total"])
        g["categories"].sort(key=lambda x: (-x["amount"], x["name"]))
        groups.append(g)
    groups.sort(key=lambda x: -x["total"])
    return groups


def compute_balance_ytd(
    conn: psycopg.Connection,
    year: int,
    through_month: int,
    categories: list[dict[str, Any]],
) -> float:
    by_id = category_by_id(categories)
    d_from, d_to = year_bounds_through_month(year, through_month)
    sums = sum_by_category(conn, d_from, d_to)
    carryover = carryover_from_sums(sums, by_id)
    income_real = income_real_from_sums(sums, by_id)
    expenses = expenses_from_sums(sums, by_id)
    return round_money(carryover + income_real - expenses)


def monthly_income_real_series(
    conn: psycopg.Connection,
    year: int,
    through_month: int,
    categories: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    by_id = category_by_id(categories)
    out: list[dict[str, Any]] = []
    for m in range(1, through_month + 1):
        ym = f"{year:04d}-{m:02d}"
        d_from, d_to = month_bounds(ym)
        sums = sum_by_category(conn, d_from, d_to)
        amount = income_real_from_sums(sums, by_id)
        out.append({"month": ym, "amount": round_money(amount)})
    return out


def monthly_balance_series(
    conn: psycopg.Connection,
    year: int,
    through_month: int,
    categories: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    by_id = category_by_id(categories)
    out: list[dict[str, Any]] = []
    for m in range(1, through_month + 1):
        ym = f"{year:04d}-{m:02d}"
        d_from, d_to = month_bounds(ym)
        sums = sum_by_category(conn, d_from, d_to)
        income_real = income_real_from_sums(sums, by_id)
        expenses = expenses_from_sums(sums, by_id)
        out.append({"month": ym, "balance": round_money(income_real - expenses)})
    return out


def monthly_assets_series(
    conn: psycopg.Connection,
    year: int,
    through_month: int,
    categories: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    by_id = category_by_id(categories)
    by_slug = category_by_slug(categories)
    out: list[dict[str, Any]] = []
    for m in range(1, through_month + 1):
        ym = f"{year:04d}-{m:02d}"
        d_from, d_to = month_bounds(ym)
        sums = sum_by_category(conn, d_from, d_to)
        assets = compute_assets_metrics(sums, by_id, by_slug)
        out.append(
            {
                "month": ym,
                "target": assets["assetsTarget"],
                "actual": assets["assetsActual"],
            }
        )
    return out


def ytd_through_month(
    year: int,
    through_month: int | None = None,
    *,
    today: date | None = None,
) -> int:
    """Сколько месяцев года включать в YTD (1–12); не дальше сегодняшнего месяца."""
    ref = today or date.today()
    if through_month is None:
        if year < ref.year:
            return 12
        if year > ref.year:
            return 0
        return ref.month
    cap = max(1, min(12, through_month))
    if year > ref.year:
        return 0
    if year == ref.year:
        return min(cap, ref.month)
    return cap


def completed_months_through(
    year: int,
    through_month: int,
    *,
    today: date | None = None,
) -> int:
    """Сколько завершенных месяцев можно брать в статистику дохода."""
    ref = today or date.today()
    if through_month <= 0:
        return 0
    if year < ref.year:
        return through_month
    if year > ref.year:
        return 0
    # Для текущего года исключаем текущий (незавершенный) месяц.
    return max(0, min(through_month, ref.month - 1))


def avg_monthly_assets_target(monthly: list[dict[str, Any]]) -> float:
    positive = [x["target"] for x in monthly if x["target"] > 0]
    if not positive:
        return 0.0
    return round_money(sum(positive) / len(positive))


def food_share_history(
    conn: psycopg.Connection,
    year: int,
    through_month: int,
    categories: list[dict[str, Any]],
    limit: int = 5,
) -> list[dict[str, Any]]:
    by_id = category_by_id(categories)
    by_slug = category_by_slug(categories)
    eda_id = int(by_slug["eda"]["id"]) if "eda" in by_slug else None
    kafe_id = int(by_slug["kafe"]["id"]) if "kafe" in by_slug else None
    out: list[dict[str, Any]] = []
    start = max(1, through_month - limit + 1)
    for m in range(start, through_month + 1):
        ym = f"{year:04d}-{m:02d}"
        d_from, d_to = month_bounds(ym)
        sums = sum_by_category(conn, d_from, d_to)
        income_real = income_real_from_sums(sums, by_id)
        food_core = 0.0
        if eda_id:
            food_core += sums.get(eda_id, 0.0)
        food_cafe = 0.0
        if kafe_id:
            food_cafe += sums.get(kafe_id, 0.0)
        food_with_cafe = food_core + food_cafe
        pct_core = compute_food_pct(income_real, food_core)
        pct_cafe = compute_food_pct(income_real, food_cafe)
        pct_with_cafe = compute_food_pct(income_real, food_with_cafe)
        out.append(
            {
                "month": ym,
                "incomeReal": round_money(income_real),
                "foodCoreAmount": round_money(food_core),
                "foodCafeAmount": round_money(food_cafe),
                "pctCore": pct_core,
                "pctCafe": pct_cafe,
                "pctWithCafe": pct_with_cafe,
                "statusCore": food_status(pct_core),
                "statusCafe": food_status(pct_cafe),
                "statusWithCafe": food_status(pct_with_cafe),
            }
        )
    return out


def food_pct_history(
    conn: psycopg.Connection,
    year: int,
    through_month: int,
    categories: list[dict[str, Any]],
    limit: int = 5,
) -> list[dict[str, Any]]:
    """Backward-compatible history for old clients: with cafe included."""
    rows = food_share_history(conn, year, through_month, categories, limit=limit)
    return [
        {
            "month": r["month"],
            "pct": r["pctWithCafe"],
            "status": r["statusWithCafe"],
        }
        for r in rows
    ]


def avg_median_income(monthly: list[dict[str, Any]]) -> tuple[float, float, int]:
    positive = [x["amount"] for x in monthly if x["amount"] > 0]
    if not positive:
        return 0.0, 0.0, 0
    return (
        round_money(sum(positive) / len(positive)),
        round_money(median(positive)),
        len(positive),
    )


def _as_date(raw: Any) -> date | None:
    if raw is None:
        return None
    if isinstance(raw, date):
        return raw
    try:
        return date.fromisoformat(str(raw)[:10])
    except ValueError:
        return None


def reminder_due_on(row: dict[str, Any], ref: date | None = None) -> date | None:
    """Ближайшее наступление: due_date если в будущем, иначе ежемесячно в day_of_month."""
    ref = ref or date.today()
    dom = int(row["day_of_month"])
    stored_due = _as_date(row.get("due_date"))
    if stored_due is not None and stored_due >= ref:
        return stored_due

    day_this_month = min(dom, calendar.monthrange(ref.year, ref.month)[1])
    candidate = date(ref.year, ref.month, day_this_month)
    if candidate >= ref:
        return candidate
    ny = ref.year + (1 if ref.month == 12 else 0)
    nm = 1 if ref.month == 12 else ref.month + 1
    day_next = min(dom, calendar.monthrange(ny, nm)[1])
    return date(ny, nm, day_next)


def reminder_to_api(row: dict[str, Any], ref: date | None = None) -> dict[str, Any]:
    ref = ref or date.today()
    due = reminder_due_on(row, ref)
    return {
        "id": int(row["id"]),
        "dayOfMonth": int(row["day_of_month"]),
        "dueDate": due.isoformat() if due else None,
        "label": row["label"],
        "amountHint": round_money(num(row["amount_hint"])) if row["amount_hint"] is not None else None,
        "isActive": bool(row["is_active"]),
        "categoryId": int(row["category_id"]) if row["category_id"] else None,
        "categorySlug": row.get("category_slug"),
        "categoryName": row.get("category_name"),
    }


def upcoming_reminders(
    conn: psycopg.Connection,
    today: date | None = None,
    within_days: int = 3,
) -> list[dict[str, Any]]:
    ref = today or date.today()
    rows = conn.execute(
        """
        SELECT r.id, r.day_of_month, r.due_date, r.label, r.amount_hint, r.is_active,
               r.category_id, c.slug AS category_slug, c.name AS category_name
        FROM finance_reminders r
        LEFT JOIN finance_categories c ON c.id = r.category_id
        WHERE r.is_active = true
        ORDER BY r.day_of_month, r.id
        """
    ).fetchall()
    result: list[dict[str, Any]] = []
    for row in rows:
        candidate = reminder_due_on(row, ref)
        if candidate is None:
            continue
        days_until = (candidate - ref).days
        if days_until > within_days:
            continue
        item = reminder_to_api(row, ref)
        item["daysUntil"] = days_until
        result.append(item)
    result.sort(key=lambda r: r["daysUntil"])
    return result


def next_reminder(
    conn: psycopg.Connection,
    today: date | None = None,
    within_days: int = 3,
) -> dict[str, Any] | None:
    items = upcoming_reminders(conn, today=today, within_days=within_days)
    return items[0] if items else None


def category_to_api(cat: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": int(cat["id"]),
        "slug": cat["slug"],
        "name": cat["name"],
        "kind": cat["kind"],
        "groupName": cat["group_name"],
        "colorKey": cat["color_key"],
        "isFixed": bool(cat["is_fixed"]),
        "isSystem": bool(cat["is_system"]),
        "sortOrder": int(cat["sort_order"]),
    }


def transaction_to_api(row: dict[str, Any], cat: dict[str, Any] | None) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": int(row["id"]),
        "txDate": row["tx_date"].isoformat(),
        "categoryId": int(row["category_id"]),
        "amount": round_money(num(row["amount"])),
        "source": row["source"],
        "createdAt": row["created_at"].isoformat() if row.get("created_at") else None,
    }
    if cat:
        out["categorySlug"] = cat["slug"]
        out["categoryName"] = cat["name"]
        out["kind"] = cat["kind"]
    if cat and cat["kind"] in ("income", "carryover") and row.get("income_note"):
        out["note"] = row["income_note"]
    return out
