"""Ledger: объекты (квартиры, авто) и распределение трат поверх finance_transactions."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from statistics import median
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import psycopg

# Finance category slug → (asset_slug, default_bucket or None)
FINANCE_INBOX_SLUGS: dict[str, tuple[str, str | None]] = {
    "ipoteka": ("sapronovo", "mortgage"),
    "dom_remont": ("sapronovo", "repair"),
    "kvartplata": ("sapronovo", "kvartplata"),
    "avto": ("audi", None),
}

APARTMENT_BUCKETS = frozenset({"mortgage", "repair", "misc", "kvartplata"})
CAR_BUCKETS = frozenset({"service", "consumables", "loan"})
LOAN_CONFIG_KINDS = frozenset({"apartment", "car"})

MORTGAGE_ALLOC_KIND_LABELS: dict[str, str] = {
    "payment": "платеж по ипотеке",
    "insurance": "страховка",
    "down_payment": "первоначальный взнос",
    "booking": "бронь",
    "domclick": "домклик",
}


def suggest_mortgage_allocation_kind(
    *,
    note: str | None = None,
    income_note: str | None = None,
    amount: float | None = None,
) -> str:
    text = f"{note or ''} {income_note or ''}".lower()
    if "страх" in text:
        return "insurance"
    if "бронь" in text:
        return "booking"
    if "домклик" in text:
        return "domclick"
    if "взнос" in text:
        return "down_payment"
    amt = num(amount) if amount is not None else 0.0
    if 60_000 <= amt <= 70_000:
        return "payment"
    return "payment"


def mortgage_allocation_label(kind: str, *, custom_label: str | None = None) -> str | None:
    preset = MORTGAGE_ALLOC_KIND_LABELS.get(kind)
    if preset:
        return preset
    custom = str(custom_label or "").strip()
    return custom or None

CAR_SERVICE_SUB_BUCKET_RU = {
    "общее": "general",
    "кузов": "body",
    "ходовая": "chassis",
    "тормозная": "chassis",
    "коробка": "chassis",
    "мотор": "motor",
    "расходники": "maintenance",
    "то": "maintenance",
}

CAR_SERVICE_PURPOSE_RU = {
    "ремонт": "repair",
    "расходники": "service",
    "то": "service",
    "стафф": "misc",
    "косметика": "misc",
    "прочее": "misc",
}

CAR_SERVICE_PURPOSES = frozenset({"repair", "service", "misc"})
CAR_SERVICE_UNITS = frozenset({"general", "body", "chassis", "motor", "maintenance"})

CAR_SERVICE_PURPOSE_LABELS = {
    "repair": "Ремонт",
    "service": "ТО и сервис",
    "misc": "Прочее",
}

CAR_SERVICE_UNIT_LABELS = {
    "general": "Общее",
    "body": "Кузов",
    "chassis": "Ходовая",
    "motor": "Мотор",
    "maintenance": "ТО / фильтры",
}

_LEGACY_SERVICE_PURPOSE = {
    "stuff": "misc",
    "cosmetic": "misc",
    "other": "misc",
    "consumables": "service",
}

_LEGACY_SERVICE_UNIT = {
    "consumables": "maintenance",
    "brakes": "chassis",
    "gearbox": "chassis",
}

CAR_CONSUMABLE_SUB_BUCKET_RU = {
    "топливо": "fuel",
    "штрафы": "fines",
    "парковка": "parking",
    "мойка": "wash",
    "пл. дороги": "tolls",
    "платные дороги": "tolls",
    "транспортный налог": "transport_tax",
    "налог": "transport_tax",
    "разное": "misc",
}

CAR_CONSUMABLE_COLUMNS = (
    ("fuel", "Топливо"),
    ("tolls", "Пл. дороги"),
    ("transport_tax", "Транспортный налог"),
    ("fines", "Штрафы"),
    ("parking", "Парковка"),
    ("wash", "Мойка"),
    ("misc", "Разное"),
)

CAR_MAINTENANCE_KINDS = frozenset({"engine_oil", "gearbox_oil"})

CAR_MAINTENANCE_LABELS = {
    "engine_oil": "Мотор",
    "gearbox_oil": "Коробка",
}


def round_money(value: float | Decimal) -> float:
    return float(Decimal(str(value)).quantize(Decimal("0.01")))


def add_ownership_year_period(period_end: date) -> date:
    """Следующая годовщина владения (тот же месяц/день)."""
    try:
        return period_end.replace(year=period_end.year + 1)
    except ValueError:
        # 29 февраля → 28 февраля
        return period_end.replace(year=period_end.year + 1, day=28)


def build_car_mileage_years(
    *,
    purchase_km: int | None,
    purchase_date: date | None,
    stored_rows: list[dict[str, Any]],
    current_km: int | None,
    ref: date | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """
    stored_rows: {period_end: date, km_driven: int}
    Возвращает (stored_api, display_api) — display = stored + текущий год владения
    после последней закрытой годовщины (in-progress или ещё не сохранённый закрытый).
    """
    ref = ref or date.today()
    stored_api: list[dict[str, Any]] = []
    baseline_km = int(purchase_km) if purchase_km is not None else 0

    for idx, row in enumerate(stored_rows, start=1):
        period_end = row["period_end"]
        if isinstance(period_end, str):
            period_end = date.fromisoformat(period_end)
        km = int(row["km_driven"])
        stored_api.append(
            {
                "yearIndex": idx,
                "periodEnd": period_end.isoformat(),
                "kmDriven": km,
                "computed": False,
            }
        )
        baseline_km += km

    display = list(stored_api)
    if not purchase_date or current_km is None:
        return stored_api, display

    if stored_rows:
        last_end = stored_rows[-1]["period_end"]
        if isinstance(last_end, str):
            last_end = date.fromisoformat(last_end)
    else:
        last_end = purchase_date

    # После закрытой годовщины показываем год до следующей (в т.ч. текущий неполный).
    if ref > last_end:
        next_end = add_ownership_year_period(last_end)
        km = max(0, int(current_km) - baseline_km)
        display.append(
            {
                "yearIndex": len(stored_api) + 1,
                "periodEnd": next_end.isoformat(),
                "kmDriven": km,
                "computed": True,
            }
        )

    return stored_api, display


def num(value: Any) -> float:
    if value is None:
        return 0.0
    return float(value)


def parse_positive_amount(raw: Any) -> float | None:
    if raw is None:
        return None
    s = str(raw).strip().replace(",", ".").replace(" ", "").replace("\u00a0", "")
    if not s:
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    if v <= 0:
        return None
    return v


def asset_to_api(row: dict[str, Any]) -> dict[str, Any]:
    purchase_date = row.get("purchase_date")
    return {
        "id": row["id"],
        "kind": row["kind"],
        "slug": row["slug"],
        "name": row["name"],
        "isActive": bool(row["is_active"]),
        "sortOrder": row["sort_order"],
        "purchaseOdometerKm": row.get("purchase_odometer_km"),
        "purchaseDate": purchase_date.isoformat() if purchase_date else None,
        "currentOdometerKm": row.get("current_odometer_km"),
    }


def allocation_to_api(row: dict[str, Any], asset: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {
        "id": row["id"],
        "assetId": row["asset_id"],
        "financeTransactionId": row.get("finance_transaction_id"),
        "txDate": row["tx_date"].isoformat() if row.get("tx_date") else None,
        "amount": round_money(row["amount"]),
        "bucket": row["bucket"],
        "subBucket": row.get("sub_bucket"),
        "label": row.get("label"),
        "purpose": row.get("purpose"),
        "source": row["source"],
        "createdAt": row["created_at"].isoformat() if row.get("created_at") else None,
    }
    if asset:
        payload["asset"] = asset_to_api(asset)
    return payload


def maintenance_to_api(row: dict[str, Any], asset: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {
        "id": row["id"],
        "assetId": row["asset_id"],
        "kind": row["kind"],
        "doneOdometerKm": row["done_odometer_km"],
        "doneDate": row["done_date"].isoformat(),
        "nextOdometerKm": row.get("next_odometer_km"),
        "label": row["label"],
        "source": row["source"],
    }
    if asset:
        payload["asset"] = asset_to_api(asset)
    return payload


def mortgage_config_to_api(row: dict[str, Any]) -> dict[str, Any]:
    """Параметры кредита на объект (ипотека или автокредит)."""
    override = row.get("principal_remaining_override")
    as_of = row.get("principal_remaining_as_of")
    return {
        "assetId": row["asset_id"],
        "principalInitial": round_money(row["principal_initial"]),
        "downPayment": round_money(row["down_payment"]),
        "annualRatePct": float(row["annual_rate_pct"]),
        "monthlyPayment": round_money(row["monthly_payment"]),
        "loanStartDate": row["loan_start_date"].isoformat(),
        "extraPayments": row.get("extra_payments_json") or [],
        "principalRemainingOverride": round_money(override) if override is not None else None,
        "principalRemainingAsOf": as_of.isoformat() if as_of else None,
        "updatedAt": row["updated_at"].isoformat() if row.get("updated_at") else None,
    }


def load_assets(conn: psycopg.Connection, *, active_only: bool = True) -> list[dict[str, Any]]:
    sql = """
        SELECT id, kind, slug, name, is_active, sort_order,
               purchase_odometer_km, purchase_date, current_odometer_km, created_at, updated_at
        FROM ledger_assets
    """
    if active_only:
        sql += " WHERE is_active = true"
    sql += " ORDER BY sort_order, id"
    return list(conn.execute(sql).fetchall())


def asset_by_slug(conn: psycopg.Connection, slug: str) -> dict[str, Any] | None:
    return conn.execute(
        """
        SELECT id, kind, slug, name, is_active, sort_order,
               purchase_odometer_km, purchase_date, current_odometer_km, created_at, updated_at
        FROM ledger_assets
        WHERE slug = %s
        """,
        (slug.strip().lower(),),
    ).fetchone()


def get_asset(conn: psycopg.Connection, asset_id: int) -> dict[str, Any] | None:
    return conn.execute(
        """
        SELECT id, kind, slug, name, is_active, sort_order,
               purchase_odometer_km, purchase_date, current_odometer_km, created_at, updated_at
        FROM ledger_assets
        WHERE id = %s
        """,
        (asset_id,),
    ).fetchone()


def validate_bucket(asset_kind: str, bucket: str) -> bool:
    if asset_kind == "apartment":
        return bucket in APARTMENT_BUCKETS
    if asset_kind == "car":
        return bucket in CAR_BUCKETS
    return False


def validate_loan_config_asset(asset: dict[str, Any] | None) -> bool:
    return bool(asset and asset.get("kind") in LOAN_CONFIG_KINDS)


def allocated_sum_for_tx(conn: psycopg.Connection, finance_transaction_id: int) -> float:
    row = conn.execute(
        """
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM ledger_allocations
        WHERE finance_transaction_id = %s
        """,
        (finance_transaction_id,),
    ).fetchone()
    return num(row["total"]) if row else 0.0


def year_bounds(year: int) -> tuple[date, date]:
    return date(year, 1, 1), date(year, 12, 31)


def month_key_from_date(d: date) -> str:
    return d.strftime("%Y-%m")


def stats_for_amounts(amounts: list[float]) -> dict[str, float | None]:
    if not amounts:
        return {"total": 0.0, "avg": None, "median": None, "count": 0}
    return {
        "total": round_money(sum(amounts)),
        "avg": round_money(sum(amounts) / len(amounts)),
        "median": round_money(median(amounts)),
        "count": len(amounts),
    }


def monthly_totals(
    conn: psycopg.Connection,
    asset_id: int,
    bucket: str,
    year: int,
    *,
    sub_bucket: str | None = None,
) -> list[dict[str, Any]]:
    d_from, d_to = year_bounds(year)
    params: list[Any] = [asset_id, bucket, d_from, d_to]
    sub_sql = ""
    if sub_bucket:
        sub_sql = " AND sub_bucket = %s"
        params.append(sub_bucket)
    rows = conn.execute(
        f"""
        SELECT to_char(tx_date, 'YYYY-MM') AS year_month, SUM(amount) AS total
        FROM ledger_allocations
        WHERE asset_id = %s AND bucket = %s
          AND tx_date BETWEEN %s AND %s
          {sub_sql}
        GROUP BY 1
        ORDER BY 1
        """,
        params,
    ).fetchall()
    return [
        {"yearMonth": r["year_month"], "total": round_money(r["total"])}
        for r in rows
    ]


def normalize_ru_key(value: Any) -> str:
    return str(value or "").strip().lower()


def map_service_sub_bucket(raw: Any) -> str | None:
    key = normalize_ru_key(raw)
    slug = CAR_SERVICE_SUB_BUCKET_RU.get(key, key or None)
    return normalize_service_unit(slug)


def map_service_purpose(raw: Any) -> str | None:
    key = normalize_ru_key(raw)
    slug = CAR_SERVICE_PURPOSE_RU.get(key, key or None)
    return normalize_service_purpose(slug)


def normalize_service_unit(raw: Any) -> str:
    slug = str(raw or "").strip().lower() or "general"
    slug = _LEGACY_SERVICE_UNIT.get(slug, slug)
    return slug if slug in CAR_SERVICE_UNITS else "general"


def normalize_service_purpose(raw: Any, *, sub_bucket: str | None = None) -> str:
    slug = str(raw or "").strip().lower()
    slug = CAR_SERVICE_PURPOSE_RU.get(slug, slug)
    slug = _LEGACY_SERVICE_PURPOSE.get(slug, slug)
    if slug in CAR_SERVICE_PURPOSES:
        return slug
    unit = normalize_service_unit(sub_bucket) if sub_bucket else "general"
    if unit == "maintenance":
        return "service"
    return "repair"


def map_consumable_sub_bucket(raw: Any) -> str | None:
    key = normalize_ru_key(raw)
    return CAR_CONSUMABLE_SUB_BUCKET_RU.get(key, key or None)
