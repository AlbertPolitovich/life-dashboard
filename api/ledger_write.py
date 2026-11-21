"""Запись Ledger: распределения, объекты, ипотека, ТО."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any
import re

import psycopg

from ledger_common import (
    FINANCE_INBOX_SLUGS,
    allocated_sum_for_tx,
    allocation_to_api,
    asset_to_api,
    get_asset,
    mortgage_config_to_api,
    parse_positive_amount,
    round_money,
    validate_bucket,
    validate_loan_config_asset,
)


def _parse_tx_date(body: dict[str, Any]) -> date | None:
    raw = str(body.get("txDate") or body.get("tx_date") or "").strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def _parse_item(conn: psycopg.Connection, item: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    asset_id_raw = item.get("assetId") or item.get("asset_id")
    try:
        asset_id = int(asset_id_raw)
    except (TypeError, ValueError):
        return None, "Укажите assetId"

    asset = get_asset(conn, asset_id)
    if not asset:
        return None, "Объект не найден"
    if not asset["is_active"]:
        return None, "Объект неактивен"

    bucket = str(item.get("bucket") or "").strip()
    if not bucket or not validate_bucket(asset["kind"], bucket):
        return None, f"Некорректный bucket для {asset['kind']}"

    amount = parse_positive_amount(item.get("amount"))
    if amount is None:
        return None, "Некорректная сумма"

    tx_date = _parse_tx_date(item)
    if tx_date is None:
        return None, "txDate: формат yyyy-MM-dd"

    finance_tx_id = item.get("financeTransactionId") or item.get("finance_transaction_id")
    finance_tx_id_int = None
    if finance_tx_id is not None:
        try:
            finance_tx_id_int = int(finance_tx_id)
        except (TypeError, ValueError):
            return None, "Некорректный financeTransactionId"

    return {
        "asset": asset,
        "asset_id": asset_id,
        "bucket": bucket,
        "amount": amount,
        "tx_date": tx_date,
        "finance_transaction_id": finance_tx_id_int,
        "sub_bucket": (str(item.get("subBucket") or item.get("sub_bucket") or "").strip() or None),
        "label": (str(item.get("label") or "").strip() or None),
        "purpose": (str(item.get("purpose") or "").strip() or None),
        "source": str(item.get("source") or "manual"),
    }, None


def _validate_finance_link(
    conn: psycopg.Connection,
    finance_transaction_id: int,
    new_amount: float,
    *,
    exclude_allocation_id: int | None = None,
) -> str | None:
    tx = conn.execute(
        """
        SELECT id, amount
        FROM finance_transactions
        WHERE id = %s
        """,
        (finance_transaction_id,),
    ).fetchone()
    if not tx:
        return "Транзакция финансов не найдена"

    allocated = allocated_sum_for_tx(conn, finance_transaction_id)
    if exclude_allocation_id:
        row = conn.execute(
            "SELECT amount FROM ledger_allocations WHERE id = %s AND finance_transaction_id = %s",
            (exclude_allocation_id, finance_transaction_id),
        ).fetchone()
        if row:
            allocated -= float(row["amount"])

    if round_money(allocated + new_amount) > round_money(tx["amount"]) + 0.001:
        return "Сумма распределений превышает сумму транзакции"
    return None


def create_allocations(conn: psycopg.Connection, body: dict[str, Any]) -> dict[str, Any]:
    raw_items = body.get("items")
    if isinstance(raw_items, list) and raw_items:
        items = []
        for item in raw_items:
            parsed, err = _parse_item(conn, item)
            if err:
                return {"ok": False, "error": err}
            items.append(parsed)
    else:
        parsed, err = _parse_item(conn, body)
        if err:
            return {"ok": False, "error": err}
        items = [parsed]

    tx_additions: dict[int, float] = {}
    for item in items:
        ft_id = item.get("finance_transaction_id")
        if ft_id:
            tx_additions[ft_id] = tx_additions.get(ft_id, 0.0) + item["amount"]

    for ft_id, add_amount in tx_additions.items():
        err = _validate_finance_link(conn, ft_id, add_amount)
        if err:
            return {"ok": False, "error": err}

    created = []
    for item in items:
        source = item.get("source") or "manual"
        if item.get("finance_transaction_id"):
            source = "finance_link"
        if source not in ("manual", "finance_link", "ledger_import"):
            source = "manual"

        row = conn.execute(
            """
            INSERT INTO ledger_allocations (
                asset_id, finance_transaction_id, tx_date, amount, bucket,
                sub_bucket, label, purpose, source
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (
                item["asset_id"],
                item.get("finance_transaction_id"),
                item["tx_date"],
                Decimal(str(item["amount"])),
                item["bucket"],
                item.get("sub_bucket"),
                item.get("label"),
                item.get("purpose"),
                source,
            ),
        ).fetchone()
        created.append(allocation_to_api(row, item["asset"]))

    return {"ok": True, "allocations": created}


def update_allocation(
    conn: psycopg.Connection,
    allocation_id: int,
    body: dict[str, Any],
) -> dict[str, Any]:
    existing = conn.execute(
        "SELECT * FROM ledger_allocations WHERE id = %s",
        (allocation_id,),
    ).fetchone()
    if not existing:
        return {"ok": False, "error": "Распределение не найдено"}

    asset = get_asset(conn, existing["asset_id"])
    if not asset:
        return {"ok": False, "error": "Объект не найден"}

    amount = parse_positive_amount(body.get("amount")) if "amount" in body else float(existing["amount"])
    if amount is None:
        return {"ok": False, "error": "Некорректная сумма"}

    bucket = str(body.get("bucket") or existing["bucket"]).strip()
    if not validate_bucket(asset["kind"], bucket):
        return {"ok": False, "error": "Некорректный bucket"}

    tx_date = _parse_tx_date(body) if body.get("txDate") or body.get("tx_date") else existing["tx_date"]

    finance_tx_id = existing["finance_transaction_id"]
    if finance_tx_id:
        err = _validate_finance_link(
            conn,
            finance_tx_id,
            amount,
            exclude_allocation_id=allocation_id,
        )
        if err:
            return {"ok": False, "error": err}

    sub_bucket = body.get("subBucket", body.get("sub_bucket", existing.get("sub_bucket")))
    label = body.get("label", existing.get("label"))
    purpose = body.get("purpose", existing.get("purpose"))

    row = conn.execute(
        """
        UPDATE ledger_allocations
        SET tx_date = %s, amount = %s, bucket = %s,
            sub_bucket = %s, label = %s, purpose = %s
        WHERE id = %s
        RETURNING *
        """,
        (
            tx_date,
            Decimal(str(amount)),
            bucket,
            (str(sub_bucket).strip() if sub_bucket else None),
            (str(label).strip() if label else None),
            (str(purpose).strip() if purpose else None),
            allocation_id,
        ),
    ).fetchone()
    return {"ok": True, "allocation": allocation_to_api(row, asset)}


def delete_allocation(conn: psycopg.Connection, allocation_id: int) -> dict[str, Any]:
    row = conn.execute(
        "DELETE FROM ledger_allocations WHERE id = %s RETURNING id",
        (allocation_id,),
    ).fetchone()
    if not row:
        return {"ok": False, "error": "Распределение не найдено"}
    return {"ok": True}


def dismiss_inbox_transaction(conn: psycopg.Connection, finance_transaction_id: int) -> dict[str, Any]:
    slugs = list(FINANCE_INBOX_SLUGS.keys())
    row = conn.execute(
        """
        SELECT ft.id
        FROM finance_transactions ft
        JOIN finance_categories fc ON fc.id = ft.category_id
        WHERE ft.id = %s
          AND ft.source = 'manual'
          AND fc.slug = ANY(%s::text[])
        """,
        (finance_transaction_id, slugs),
    ).fetchone()
    if not row:
        return {"ok": False, "error": "Транзакция не найдена или не в inbox"}
    conn.execute(
        """
        INSERT INTO ledger_inbox_dismissed (finance_transaction_id)
        VALUES (%s)
        ON CONFLICT DO NOTHING
        """,
        (finance_transaction_id,),
    )
    return {"ok": True}


def upsert_asset(conn: psycopg.Connection, body: dict[str, Any]) -> dict[str, Any]:
    kind = str(body.get("kind") or "").strip()
    if kind not in ("apartment", "car"):
        return {"ok": False, "error": "kind: apartment или car"}

    name = str(body.get("name") or "").strip()
    if not name:
        return {"ok": False, "error": "Укажите name"}

    slug = str(body.get("slug") or "").strip().lower()
    if not slug:
        slug = name.lower().replace(" ", "-")

    asset_id = body.get("id") or body.get("assetId")
    purchase_km = body.get("purchaseOdometerKm") or body.get("purchase_odometer_km")
    current_km = body.get("currentOdometerKm") or body.get("current_odometer_km")
    purchase_date = _parse_purchase_date(body)

    if asset_id:
        row = conn.execute(
            """
            UPDATE ledger_assets
            SET name = %s, slug = %s, is_active = COALESCE(%s, is_active),
                purchase_odometer_km = COALESCE(%s, purchase_odometer_km),
                purchase_date = COALESCE(%s, purchase_date),
                current_odometer_km = COALESCE(%s, current_odometer_km),
                updated_at = now()
            WHERE id = %s
            RETURNING *
            """,
            (
                name,
                slug,
                body.get("isActive"),
                purchase_km,
                purchase_date,
                current_km,
                int(asset_id),
            ),
        ).fetchone()
    else:
        row = conn.execute(
            """
            INSERT INTO ledger_assets (
                kind, slug, name, sort_order,
                purchase_odometer_km, purchase_date, current_odometer_km
            )
            VALUES (%s, %s, %s, COALESCE(%s, 0), %s, %s, %s)
            ON CONFLICT (slug) DO UPDATE SET
                name = EXCLUDED.name,
                kind = EXCLUDED.kind,
                purchase_odometer_km = COALESCE(EXCLUDED.purchase_odometer_km, ledger_assets.purchase_odometer_km),
                purchase_date = COALESCE(EXCLUDED.purchase_date, ledger_assets.purchase_date),
                current_odometer_km = COALESCE(EXCLUDED.current_odometer_km, ledger_assets.current_odometer_km),
                updated_at = now()
            RETURNING *
            """,
            (
                kind,
                slug,
                name,
                body.get("sortOrder"),
                purchase_km,
                purchase_date,
                current_km,
            ),
        ).fetchone()

    if not row:
        return {"ok": False, "error": "Не удалось сохранить объект"}
    return {"ok": True, "asset": asset_to_api(row)}


def save_loan_config(conn: psycopg.Connection, asset_id: int, body: dict[str, Any]) -> dict[str, Any]:
    asset = get_asset(conn, asset_id)
    if not validate_loan_config_asset(asset):
        return {"ok": False, "error": "Объект не найден или кредит недоступен для этого типа"}

    principal = parse_positive_amount(body.get("principalInitial") or body.get("principal_initial"))
    monthly = parse_positive_amount(body.get("monthlyPayment") or body.get("monthly_payment"))
    if principal is None or monthly is None:
        return {"ok": False, "error": "principalInitial и monthlyPayment обязательны"}

    try:
        rate = float(body.get("annualRatePct") or body.get("annual_rate_pct"))
    except (TypeError, ValueError):
        return {"ok": False, "error": "annualRatePct обязателен"}

    loan_start = _parse_tx_date({"txDate": body.get("loanStartDate") or body.get("loan_start_date")})
    if loan_start is None:
        return {"ok": False, "error": "loanStartDate: yyyy-MM-dd"}

    down_payment = parse_positive_amount(body.get("downPayment") or body.get("down_payment")) or 0.0
    extra = body.get("extraPayments") or body.get("extra_payments_json") or []
    override_raw = body.get("principalRemainingOverride") or body.get("principal_remaining_override")
    override_as_of_raw = body.get("principalRemainingAsOf") or body.get("principal_remaining_as_of")
    override = parse_positive_amount(override_raw) if override_raw not in (None, "") else None
    override_as_of = _parse_tx_date({"txDate": override_as_of_raw}) if override_as_of_raw else None

    row = conn.execute(
        """
        INSERT INTO ledger_mortgage_config (
            asset_id, principal_initial, down_payment, annual_rate_pct,
            monthly_payment, loan_start_date, extra_payments_json,
            principal_remaining_override, principal_remaining_as_of, updated_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, now())
        ON CONFLICT (asset_id) DO UPDATE SET
            principal_initial = EXCLUDED.principal_initial,
            down_payment = EXCLUDED.down_payment,
            annual_rate_pct = EXCLUDED.annual_rate_pct,
            monthly_payment = EXCLUDED.monthly_payment,
            loan_start_date = EXCLUDED.loan_start_date,
            extra_payments_json = EXCLUDED.extra_payments_json,
            principal_remaining_override = COALESCE(
                EXCLUDED.principal_remaining_override, ledger_mortgage_config.principal_remaining_override
            ),
            principal_remaining_as_of = COALESCE(
                EXCLUDED.principal_remaining_as_of, ledger_mortgage_config.principal_remaining_as_of
            ),
            updated_at = now()
        RETURNING *
        """,
        (
            asset_id,
            Decimal(str(principal)),
            Decimal(str(down_payment)),
            Decimal(str(rate)),
            Decimal(str(monthly)),
            loan_start,
            psycopg.types.json.Json(extra),
            Decimal(str(override)) if override is not None else None,
            override_as_of,
        ),
    ).fetchone()
    return {"ok": True, "config": mortgage_config_to_api(row), "asset": asset_to_api(asset)}


def save_mortgage_config(conn: psycopg.Connection, asset_id: int, body: dict[str, Any]) -> dict[str, Any]:
    return save_loan_config(conn, asset_id, body)


def _parse_purchase_date(body: dict[str, Any]) -> date | None:
    raw = str(body.get("purchaseDate") or body.get("purchase_date") or "").strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def _parse_odometer_km(raw: Any) -> int | None:
    if raw is None or raw == "":
        return None
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        km = int(round(float(raw)))
        return km if km >= 0 else None
    s = str(raw).strip().replace("\u00a0", "").replace("\u202f", "").replace(" ", "")
    if not s:
        return None
    # 298.074 / 298,074 → thousand groups, not decimals
    if re.fullmatch(r"\d{1,3}([.,]\d{3})+", s):
        s = s.replace(".", "").replace(",", "")
    else:
        s = s.replace(",", ".")
    try:
        km = int(round(float(s)))
    except (TypeError, ValueError):
        return None
    if km < 0:
        return None
    return km


def _car_asset_or_error(conn: psycopg.Connection, asset_id: int) -> tuple[dict[str, Any] | None, str | None]:
    asset = get_asset(conn, asset_id)
    if not asset:
        return None, "Объект не найден"
    if asset["kind"] != "car":
        return None, "Объект не автомобиль"
    return asset, None


def update_car_odometer(conn: psycopg.Connection, asset_id: int, body: dict[str, Any]) -> dict[str, Any]:
    asset, err = _car_asset_or_error(conn, asset_id)
    if err:
        return {"ok": False, "error": err}

    current_km = _parse_odometer_km(body.get("currentOdometerKm") or body.get("current_odometer_km"))
    if current_km is None:
        return {"ok": False, "error": "Укажите currentOdometerKm"}

    row = conn.execute(
        """
        UPDATE ledger_assets
        SET current_odometer_km = %s, updated_at = now()
        WHERE id = %s
        RETURNING *
        """,
        (current_km, asset_id),
    ).fetchone()
    return {"ok": True, "asset": asset_to_api(row)}


def save_car_maintenance(conn: psycopg.Connection, asset_id: int, body: dict[str, Any]) -> dict[str, Any]:
    from ledger_common import CAR_MAINTENANCE_KINDS

    asset, err = _car_asset_or_error(conn, asset_id)
    if err:
        return {"ok": False, "error": err}

    kind = str(body.get("kind") or "").strip()
    if kind not in CAR_MAINTENANCE_KINDS:
        return {"ok": False, "error": "kind: engine_oil или gearbox_oil"}

    last_km = _parse_odometer_km(body.get("lastOdometerKm") or body.get("last_odometer_km"))
    if last_km is None:
        return {"ok": False, "error": "Укажите lastOdometerKm"}

    interval_raw = body.get("intervalKm", body.get("interval_km"))
    existing = conn.execute(
        "SELECT interval_km FROM ledger_car_maintenance WHERE asset_id = %s AND kind = %s",
        (asset_id, kind),
    ).fetchone()
    if interval_raw is not None and interval_raw != "":
        interval_km = _parse_odometer_km(interval_raw)
        if interval_km is None or interval_km <= 0:
            return {"ok": False, "error": "intervalKm должен быть > 0"}
    elif existing:
        interval_km = int(existing["interval_km"])
    else:
        return {"ok": False, "error": "Укажите intervalKm"}

    conn.execute(
        """
        INSERT INTO ledger_car_maintenance (asset_id, kind, last_odometer_km, interval_km, updated_at)
        VALUES (%s, %s, %s, %s, now())
        ON CONFLICT (asset_id, kind) DO UPDATE SET
            last_odometer_km = EXCLUDED.last_odometer_km,
            interval_km = EXCLUDED.interval_km,
            updated_at = now()
        """,
        (asset_id, kind, last_km, interval_km),
    )

    current_km = body.get("currentOdometerKm", body.get("current_odometer_km"))
    if current_km is not None and current_km != "":
        parsed_current = _parse_odometer_km(current_km)
        if parsed_current is not None:
            conn.execute(
                """
                UPDATE ledger_assets
                SET current_odometer_km = %s, updated_at = now()
                WHERE id = %s
                """,
                (parsed_current, asset_id),
            )

    return {"ok": True}


def add_car_mileage_year(conn: psycopg.Connection, asset_id: int, body: dict[str, Any]) -> dict[str, Any]:
    asset, err = _car_asset_or_error(conn, asset_id)
    if err:
        return {"ok": False, "error": err}

    period_end = _parse_tx_date({"txDate": body.get("periodEnd") or body.get("period_end")})
    if period_end is None:
        return {"ok": False, "error": "periodEnd: yyyy-MM-dd"}

    km_driven = _parse_odometer_km(body.get("kmDriven") or body.get("km_driven"))
    if km_driven is None:
        return {"ok": False, "error": "Укажите kmDriven"}

    conn.execute(
        """
        INSERT INTO ledger_car_mileage_years (asset_id, period_end, km_driven)
        VALUES (%s, %s, %s)
        ON CONFLICT (asset_id, period_end) DO UPDATE SET km_driven = EXCLUDED.km_driven
        """,
        (asset_id, period_end, km_driven),
    )

    return {"ok": True}
