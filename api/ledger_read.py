"""Чтение Ledger: объекты, inbox, распределения, сводки."""

from __future__ import annotations

import re
from datetime import date
from typing import Any

import psycopg

from finance_common import transaction_to_api
from ledger_common import (
    FINANCE_INBOX_SLUGS,
    CAR_MAINTENANCE_LABELS,
    build_car_mileage_years,
    allocation_to_api,
    asset_to_api,
    get_asset,
    load_assets,
    maintenance_to_api,
    month_key_from_date,
    monthly_totals,
    mortgage_config_to_api,
    normalize_service_purpose,
    normalize_service_unit,
    num,
    round_money,
    stats_for_amounts,
    suggest_mortgage_allocation_kind,
    validate_loan_config_asset,
    year_bounds,
)


def list_ledger_assets(conn: psycopg.Connection, *, active_only: bool = True) -> list[dict[str, Any]]:
    return [asset_to_api(row) for row in load_assets(conn, active_only=active_only)]


def _inbox_transaction_to_api(row: dict[str, Any], cat: dict[str, Any]) -> dict[str, Any]:
    tx = transaction_to_api(row, cat)
    note = row.get("income_note")
    if note:
        tx["note"] = str(note).strip()
    return tx


def build_ledger_inbox(
    conn: psycopg.Connection,
    *,
    month: str | None = None,
) -> dict[str, Any]:
    """Очередь: только manual-траты без распределения; excel_import и dismissed — скрыты."""
    slugs = list(FINANCE_INBOX_SLUGS.keys())
    params: list[Any] = [slugs]
    month_sql = ""
    if month:
        month_sql = " AND to_char(ft.tx_date, 'YYYY-MM') = %s"
        params.append(month)

    rows = conn.execute(
        f"""
        SELECT
            ft.id,
            ft.tx_date,
            ft.category_id,
            ft.amount,
            ft.income_note,
            ft.source,
            ft.created_at,
            fc.slug AS category_slug,
            fc.name AS category_name,
            fc.kind AS category_kind,
            COALESCE(SUM(la.amount), 0) AS allocated_sum
        FROM finance_transactions ft
        JOIN finance_categories fc ON fc.id = ft.category_id
        LEFT JOIN ledger_allocations la ON la.finance_transaction_id = ft.id
        LEFT JOIN ledger_inbox_dismissed d ON d.finance_transaction_id = ft.id
        WHERE fc.slug = ANY(%s::text[])
          AND ft.source = 'manual'
          AND d.finance_transaction_id IS NULL
        {month_sql}
        GROUP BY ft.id, fc.id
        HAVING COALESCE(SUM(la.amount), 0) < ft.amount
        ORDER BY ft.tx_date DESC, ft.id DESC
        """,
        params,
    ).fetchall()

    assets = {a["slug"]: a for a in load_assets(conn)}
    items = []
    for row in rows:
        hint = FINANCE_INBOX_SLUGS.get(row["category_slug"])
        asset_slug, default_bucket = hint if hint else (None, None)
        asset = assets.get(asset_slug) if asset_slug else None
        allocated = num(row["allocated_sum"])
        amount = num(row["amount"])
        cat = {
            "id": row["category_id"],
            "slug": row["category_slug"],
            "name": row["category_name"],
            "kind": row["category_kind"],
        }
        note = row.get("income_note") or ""
        suggested_sub = None
        suggested_purpose = None
        if row["category_slug"] == "avto":
            note_l = note.lower()
            if ("транспортн" in note_l and "налог" in note_l) or (
                "налог" in note_l and ("транспорт" in note_l or "авто" in note_l)
            ):
                default_bucket = "consumables"
                suggested_sub = "transport_tax"
                m = re.search(r"за\s*(20\d{2})", note, flags=re.I)
                if m:
                    suggested_purpose = m.group(1)
                elif row.get("tx_date"):
                    suggested_purpose = str(int(str(row["tx_date"])[:4]) - 1)
        items.append(
            {
                "transaction": _inbox_transaction_to_api(row, cat),
                "allocatedSum": round_money(allocated),
                "remainingSum": round_money(amount - allocated),
                "suggestedAsset": asset_to_api(asset) if asset else None,
                "suggestedBucket": default_bucket,
                "suggestedSubBucket": suggested_sub,
                "suggestedPurpose": suggested_purpose,
                "suggestedMortgageKind": (
                    suggest_mortgage_allocation_kind(
                        note=row.get("income_note"),
                        amount=amount,
                    )
                    if row["category_slug"] == "ipoteka"
                    else None
                ),
            }
        )
    return {"ok": True, "items": items}


def list_ledger_allocations(
    conn: psycopg.Connection,
    *,
    asset_id: int | None = None,
    bucket: str | None = None,
    year: int | None = None,
    month: str | None = None,
) -> dict[str, Any]:
    clauses = ["1=1"]
    params: list[Any] = []
    if asset_id:
        clauses.append("la.asset_id = %s")
        params.append(asset_id)
    if bucket:
        clauses.append("la.bucket = %s")
        params.append(bucket)
    if month:
        clauses.append("to_char(la.tx_date, 'YYYY-MM') = %s")
        params.append(month)
    elif year:
        d_from, d_to = year_bounds(year)
        clauses.append("la.tx_date BETWEEN %s AND %s")
        params.extend([d_from, d_to])

    rows = conn.execute(
        f"""
        SELECT la.*, a.kind, a.slug AS asset_slug, a.name AS asset_name,
               a.is_active, a.sort_order, a.purchase_odometer_km, a.current_odometer_km
        FROM ledger_allocations la
        JOIN ledger_assets a ON a.id = la.asset_id
        WHERE {' AND '.join(clauses)}
        ORDER BY la.tx_date DESC, la.id DESC
        """,
        params,
    ).fetchall()

    items = []
    for row in rows:
        asset = {
            "id": row["asset_id"],
            "kind": row["kind"],
            "slug": row["asset_slug"],
            "name": row["asset_name"],
            "is_active": row["is_active"],
            "sort_order": row["sort_order"],
            "purchase_odometer_km": row["purchase_odometer_km"],
            "current_odometer_km": row["current_odometer_km"],
        }
        items.append(allocation_to_api(row, asset))
    return {"ok": True, "allocations": items}


FULL_CREDIT_COST = 38_200_392.60

MORTGAGE_ANCILLARY_KEYWORDS = ("бронь", "домклик", "взнос", "страхов", "страх")


def _mortgage_label_lower(label: Any) -> str:
    return str(label or "").strip().lower()


def is_mortgage_ancillary(label: Any) -> bool:
    text = _mortgage_label_lower(label)
    return any(key in text for key in MORTGAGE_ANCILLARY_KEYWORDS)


def is_mortgage_monthly_payment(label: Any, amount: float) -> bool:
    if is_mortgage_ancillary(label):
        return False
    text = _mortgage_label_lower(label)
    if "платеж" in text or "ипотек" in text:
        return True
    return 60_000 <= amount <= 70_000


def bucket_all_time_totals(conn: psycopg.Connection, asset_id: int) -> dict[str, float]:
    rows = conn.execute(
        """
        SELECT bucket, COALESCE(SUM(amount), 0) AS total
        FROM ledger_allocations
        WHERE asset_id = %s
        GROUP BY bucket
        """,
        (asset_id,),
    ).fetchall()
    return {row["bucket"]: round_money(row["total"]) for row in rows}


def load_mortgage_schedule_rows(conn: psycopg.Connection, asset_id: int) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT payment_no, due_date, payment_total, principal_part, interest_part, balance_after
        FROM ledger_mortgage_schedule
        WHERE asset_id = %s
        ORDER BY payment_no
        """,
        (asset_id,),
    ).fetchall()
    return [
        {
            "paymentNo": int(row["payment_no"]),
            "dueDate": row["due_date"].isoformat(),
            "paymentTotal": round_money(row["payment_total"]),
            "principalPart": round_money(row["principal_part"]),
            "interestPart": round_money(row["interest_part"]),
            "balanceAfter": round_money(row["balance_after"]),
        }
        for row in rows
    ]


def _match_schedule_payment(
    schedule: list[dict[str, Any]],
    tx_date: date,
) -> dict[str, Any] | None:
    if not schedule:
        return None
    ym = month_key_from_date(tx_date)
    same_month = [row for row in schedule if row["dueDate"][:7] == ym and row["paymentTotal"] > 0]
    if same_month:
        return same_month[0]
    before = [row for row in schedule if row["dueDate"] <= tx_date.isoformat() and row["paymentTotal"] > 0]
    if before:
        return before[-1]
    return None


def _schedule_row_by_no(schedule: list[dict[str, Any]], payment_no: int) -> dict[str, Any] | None:
    return next((row for row in schedule if row["paymentNo"] == payment_no), None)


def _mortgage_max_early_extra(scheduled_payment: float) -> float:
    return round_money(max(0.0, num(scheduled_payment) * 0.2))


def _project_mortgage_remaining(
    schedule: list[dict[str, Any]],
    after_payment_no: int,
    principal_balance: float,
) -> tuple[int, str | None]:
    """Сколько платежей и какая дата останутся после фактического остатка долга."""
    balance = max(0.0, num(principal_balance))
    count = 0
    end_date: str | None = None
    for row in schedule:
        if int(row["paymentNo"]) <= after_payment_no:
            continue
        if num(row["paymentTotal"]) <= 0:
            continue
        if balance <= 0.01:
            break
        principal_part = num(row["principalPart"])
        pay_principal = min(principal_part, balance) if principal_part > 0 else balance
        balance = round_money(max(0.0, balance - pay_principal))
        count += 1
        end_date = row["dueDate"]
    return count, end_date


def _parse_iso_date(raw: Any) -> date | None:
    if raw is None:
        return None
    if isinstance(raw, date):
        return raw
    try:
        return date.fromisoformat(str(raw)[:10])
    except ValueError:
        return None


def compute_mortgage_principal_state(
    *,
    principal_initial: float,
    loan_start_date: date,
    schedule: list[dict[str, Any]],
    monthly_payments: list[dict[str, Any]],
    extra_payments: list[dict[str, Any]] | None = None,
    principal_override: float | None = None,
    principal_override_as_of: date | None = None,
) -> dict[str, Any]:
    """
    Фактический остаток долга:
    - плановый платёж: проценты + тело по графику (с учётом досрочной даты → меньше процентов);
    - сверх плана до +20% от платежа графика — досрочно в тело (уменьшение срока);
    - сверх плана больше +20% — остаток на счёте ипотеки, не в тело.
    """
    matched_nos: set[int] = set()
    payment_details: list[dict[str, Any]] = []
    balance = principal_initial
    schedule_balance = principal_initial
    surplus_on_account = 0.0
    early_principal_total = 0.0
    applied_total = 0.0
    transferred_total = 0.0
    period_anchor = loan_start_date

    for item in sorted(monthly_payments, key=lambda row: row["txDate"]):
        tx_date = _parse_iso_date(item["txDate"])
        if tx_date is None:
            continue
        transferred = num(item["amount"])
        transferred_total = round_money(transferred_total + transferred)
        match = _match_schedule_payment(schedule, tx_date)
        if not match:
            continue
        payment_no = int(match["paymentNo"])
        matched_nos.add(payment_no)
        due_date = _parse_iso_date(match["dueDate"])
        scheduled_payment = num(match["paymentTotal"])
        scheduled_interest = num(match["interestPart"])
        max_early = _mortgage_max_early_extra(scheduled_payment)
        max_applicable = round_money(scheduled_payment + max_early)

        period_days = (due_date - period_anchor).days if due_date and period_anchor else 0
        actual_days = (tx_date - period_anchor).days if period_anchor else 0
        if period_days > 0 and actual_days >= 0:
            ratio = min(1.0, actual_days / period_days)
        else:
            ratio = 1.0

        if transferred >= scheduled_payment:
            early_extra = round_money(min(transferred - scheduled_payment, max_early))
            surplus = round_money(max(0.0, transferred - max_applicable))
            interest_applied = round_money(scheduled_interest * ratio)
            principal_scheduled = round_money(max(0.0, scheduled_payment - interest_applied))
            principal_applied = round_money(principal_scheduled + early_extra)
            applied = round_money(scheduled_payment + early_extra)
        else:
            early_extra = 0.0
            surplus = 0.0
            applied = round_money(transferred)
            interest_applied = round_money(scheduled_interest * ratio * (transferred / scheduled_payment))
            principal_applied = round_money(max(0.0, applied - interest_applied))

        applied_total = round_money(applied_total + applied)
        surplus_on_account = round_money(surplus_on_account + surplus)
        early_principal_total = round_money(early_principal_total + early_extra)
        balance = round_money(max(0.0, balance - principal_applied))

        sched_row = _schedule_row_by_no(schedule, payment_no)
        if sched_row:
            schedule_balance = num(sched_row["balanceAfter"])

        payment_details.append(
            {
                "txDate": tx_date.isoformat(),
                "transferred": round_money(transferred),
                "applied": applied,
                "surplus": surplus,
                "earlyExtra": early_extra,
                "maxEarlyAllowed": max_early,
                "paymentNo": payment_no,
                "dueDate": match["dueDate"],
                "interestApplied": interest_applied,
                "principalApplied": principal_applied,
                "balanceAfter": balance,
                "scheduleBalanceAfter": round_money(schedule_balance),
                "paidEarly": bool(due_date and tx_date < due_date),
            }
        )

        if due_date and tx_date < due_date:
            period_anchor = tx_date
        elif due_date:
            period_anchor = due_date

    extra_total = round_money(
        sum(num(item.get("amount", 0)) for item in (extra_payments or []) if item.get("mode") != "snapshot")
    )
    balance_after_extras = max(0.0, round_money(balance - extra_total))

    use_override = principal_override is not None and principal_override > 0
    if use_override and principal_override_as_of:
        for item in monthly_payments:
            tx_date = _parse_iso_date(item["txDate"])
            if tx_date and tx_date > principal_override_as_of:
                use_override = False
                break
    principal_remaining = (
        round_money(principal_override) if use_override else balance_after_extras
    )

    last_matched_no = max(matched_nos) if matched_nos else 0
    schedule_row = _schedule_row_by_no(schedule, last_matched_no) if last_matched_no else None
    schedule_principal_remaining = (
        num(schedule_row["balanceAfter"]) if schedule_row else principal_initial
    )

    principal_paid = max(0.0, round_money(principal_initial - principal_remaining))
    progress_pct = round(principal_paid / principal_initial * 100, 2) if principal_initial else 0.0
    remaining_payments, projected_end_date = _project_mortgage_remaining(
        schedule, last_matched_no, principal_remaining
    )

    return {
        "principalRemaining": principal_remaining,
        "principalPaid": principal_paid,
        "progressPct": progress_pct,
        "lastMatchedPaymentNo": last_matched_no,
        "paymentsMatched": len(matched_nos),
        "surplusOnAccount": surplus_on_account,
        "earlyPrincipalTotal": early_principal_total,
        "transferredTotal": round_money(transferred_total),
        "appliedTotal": round_money(applied_total),
        "schedulePrincipalRemaining": round_money(schedule_principal_remaining),
        "scheduleDelta": round_money(schedule_principal_remaining - principal_remaining),
        "paymentDetails": payment_details,
        "extraPaymentsTotal": extra_total,
        "remainingPayments": remaining_payments,
        "projectedEndDate": projected_end_date,
        "usedBalanceOverride": use_override,
        "balanceOverrideAsOf": principal_override_as_of.isoformat() if use_override and principal_override_as_of else None,
    }


def _mortgage_allocations(conn: psycopg.Connection, asset_id: int) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT tx_date, amount, label
        FROM ledger_allocations
        WHERE asset_id = %s AND bucket = 'mortgage'
        ORDER BY tx_date, id
        """,
        (asset_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def build_mortgage_progress(conn: psycopg.Connection, asset_id: int) -> dict[str, Any]:
    asset = get_asset(conn, asset_id)
    if not asset or asset["kind"] != "apartment":
        return {"ok": False, "error": "Объект не найден или не квартира"}

    cfg_row = conn.execute(
        "SELECT * FROM ledger_mortgage_config WHERE asset_id = %s",
        (asset_id,),
    ).fetchone()
    schedule = load_mortgage_schedule_rows(conn, asset_id)
    allocs = _mortgage_allocations(conn, asset_id)

    if not cfg_row:
        return {
            "ok": True,
            "asset": asset_to_api(asset),
            "config": None,
            "metricsReady": False,
        }

    config = mortgage_config_to_api(cfg_row)
    principal_initial = num(cfg_row["principal_initial"])
    loan_start = cfg_row["loan_start_date"]
    extras = cfg_row.get("extra_payments_json") or []
    override_raw = cfg_row.get("principal_remaining_override")
    override_as_of = cfg_row.get("principal_remaining_as_of")

    monthly_payments: list[dict[str, Any]] = []
    ancillary_items: list[dict[str, Any]] = []

    for row in allocs:
        amount = num(row["amount"])
        label = row.get("label")
        item = {
            "txDate": row["tx_date"].isoformat(),
            "amount": round_money(amount),
            "label": label,
        }
        if is_mortgage_ancillary(label):
            ancillary_items.append(item)
            continue
        if is_mortgage_monthly_payment(label, amount):
            monthly_payments.append(item)

    principal_state = compute_mortgage_principal_state(
        principal_initial=principal_initial,
        loan_start_date=loan_start,
        schedule=schedule,
        monthly_payments=monthly_payments,
        extra_payments=extras,
        principal_override=num(override_raw) if override_raw is not None else None,
        principal_override_as_of=override_as_of,
    )

    principal_remaining = principal_state["principalRemaining"]
    principal_paid = principal_state["principalPaid"]
    progress_pct = principal_state["progressPct"]
    last_matched_no = principal_state["lastMatchedPaymentNo"]
    extra_total = principal_state["extraPaymentsTotal"]

    future_rows = [
        row for row in schedule if row["paymentNo"] > last_matched_no and row["paymentTotal"] > 0
    ]
    next_payment = future_rows[0] if future_rows else None
    schedule_end = schedule[-1] if schedule else None
    remaining_payments = principal_state.get("remainingPayments", len(future_rows))
    projected_end_date = principal_state.get("projectedEndDate")
    schedule_end_date = projected_end_date or (schedule_end["dueDate"] if schedule_end else None)

    scheduled_for_extra = next_payment or (
        schedule[-1] if schedule and schedule[-1]["paymentTotal"] > 0 else None
    )
    max_extra_20_pct = (
        round_money(num(scheduled_for_extra["paymentTotal"]) * 0.2)
        if scheduled_for_extra
        else None
    )

    insurance_by_year: dict[int, float] = {}
    ancillary_breakdown = {
        "downPayment": 0.0,
        "booking": 0.0,
        "domclick": 0.0,
        "insurance": 0.0,
        "other": 0.0,
    }
    for item in ancillary_items:
        amount = num(item["amount"])
        label = _mortgage_label_lower(item.get("label"))
        if "взнос" in label:
            ancillary_breakdown["downPayment"] = round_money(ancillary_breakdown["downPayment"] + amount)
        elif "бронь" in label:
            ancillary_breakdown["booking"] = round_money(ancillary_breakdown["booking"] + amount)
        elif "домклик" in label:
            ancillary_breakdown["domclick"] = round_money(ancillary_breakdown["domclick"] + amount)
        elif "страх" in label:
            ancillary_breakdown["insurance"] = round_money(ancillary_breakdown["insurance"] + amount)
            year = int(item["txDate"][:4])
            insurance_by_year[year] = round_money(insurance_by_year.get(year, 0) + amount)
        else:
            ancillary_breakdown["other"] = round_money(ancillary_breakdown["other"] + amount)

    mortgage_paid_total = round_money(sum(num(row["amount"]) for row in allocs))
    monthly_paid_total = round_money(sum(item["amount"] for item in monthly_payments))

    return {
        "ok": True,
        "asset": asset_to_api(asset),
        "config": config,
        "metricsReady": bool(schedule),
        "principalInitial": round_money(principal_initial),
        "principalRemaining": principal_remaining,
        "principalPaid": principal_paid,
        "progressPct": progress_pct,
        "lastMatchedPaymentNo": last_matched_no,
        "paymentsMatched": principal_state["paymentsMatched"],
        "surplusOnAccount": principal_state["surplusOnAccount"],
        "earlyPrincipalTotal": principal_state.get("earlyPrincipalTotal", 0.0),
        "transferredTotal": principal_state["transferredTotal"],
        "appliedTotal": principal_state["appliedTotal"],
        "schedulePrincipalRemaining": principal_state["schedulePrincipalRemaining"],
        "scheduleDelta": principal_state["scheduleDelta"],
        "paymentDetails": principal_state["paymentDetails"],
        "usedBalanceOverride": principal_state["usedBalanceOverride"],
        "balanceOverrideAsOf": principal_state["balanceOverrideAsOf"],
        "nextPayment": next_payment,
        "scheduleEndDate": schedule_end_date,
        "scheduleEndDateOriginal": schedule_end["dueDate"] if schedule_end else None,
        "remainingPayments": remaining_payments,
        "remainingPaymentsOriginal": len(future_rows),
        "maxExtra20Pct": max_extra_20_pct,
        "extraPaymentsTotal": extra_total,
        "fullCreditCost": round_money(FULL_CREDIT_COST),
        "mortgagePaidTotal": mortgage_paid_total,
        "monthlyPaidTotal": monthly_paid_total,
        "ancillaryBreakdown": ancillary_breakdown,
        "insuranceByYear": [
            {"year": year, "total": total}
            for year, total in sorted(insurance_by_year.items())
        ],
    }


def build_mortgage_schedule(conn: psycopg.Connection, asset_id: int) -> dict[str, Any]:
    asset = get_asset(conn, asset_id)
    if not asset or asset["kind"] != "apartment":
        return {"ok": False, "error": "Объект не найден или не квартира"}

    schedule = load_mortgage_schedule_rows(conn, asset_id)
    allocs = _mortgage_allocations(conn, asset_id)
    paid_nos: set[int] = set()
    for row in allocs:
        if not is_mortgage_monthly_payment(row.get("label"), num(row["amount"])):
            continue
        match = _match_schedule_payment(schedule, row["tx_date"])
        if match:
            paid_nos.add(int(match["paymentNo"]))

    rows = [{**row, "isPaid": row["paymentNo"] in paid_nos} for row in schedule]
    return {
        "ok": True,
        "asset": asset_to_api(asset),
        "rows": rows,
        "paidCount": len(paid_nos),
    }


def build_apartment_summary(
    conn: psycopg.Connection,
    asset_id: int,
    year: int,
) -> dict[str, Any]:
    asset = get_asset(conn, asset_id)
    if not asset or asset["kind"] != "apartment":
        return {"ok": False, "error": "Объект не найден или не квартира"}

    d_from, d_to = year_bounds(year)
    rows = conn.execute(
        """
        SELECT bucket, to_char(tx_date, 'YYYY-MM') AS year_month, amount, label
        FROM ledger_allocations
        WHERE asset_id = %s AND tx_date BETWEEN %s AND %s
        ORDER BY tx_date
        """,
        (asset_id, d_from, d_to),
    ).fetchall()

    by_bucket: dict[str, list[float]] = {
        "mortgage": [],
        "repair": [],
        "misc": [],
        "kvartplata": [],
    }
    monthly: dict[str, dict[str, float]] = {}
    for row in rows:
        bucket = row["bucket"]
        amount = num(row["amount"])
        ym = row["year_month"]
        by_bucket.setdefault(bucket, []).append(amount)
        monthly.setdefault(ym, {})
        monthly[ym][bucket] = round_money(monthly[ym].get(bucket, 0) + amount)

    mortgage_cfg = conn.execute(
        "SELECT * FROM ledger_mortgage_config WHERE asset_id = %s",
        (asset_id,),
    ).fetchone()

    all_time = bucket_all_time_totals(conn, asset_id)
    mortgage_progress = build_mortgage_progress(conn, asset_id)
    kvart_monthly = monthly_totals(conn, asset_id, "kvartplata", year)
    kvart_amounts = [num(item["total"]) for item in kvart_monthly if num(item["total"]) > 0]

    repair_monthly: list[dict[str, Any]] = []
    for ym, vals in sorted(monthly.items()):
        total = round_money(vals.get("repair", 0) + vals.get("misc", 0))
        if total > 0:
            repair_monthly.append({"yearMonth": ym, "total": total})

    return {
        "ok": True,
        "asset": asset_to_api(asset),
        "year": year,
        "allTimeTotals": {
            "mortgage": all_time.get("mortgage", 0.0),
            "repair": all_time.get("repair", 0.0),
            "misc": all_time.get("misc", 0.0),
            "kvartplata": all_time.get("kvartplata", 0.0),
        },
        "buckets": {
            bucket: {
                **stats_for_amounts(amounts),
                "monthly": monthly_totals(conn, asset_id, bucket, year),
                "allTimeTotal": all_time.get(bucket, 0.0),
            }
            for bucket, amounts in by_bucket.items()
        },
        "monthlyPivot": [
            {"yearMonth": ym, **vals, "total": round_money(sum(vals.values()))}
            for ym, vals in sorted(monthly.items())
        ],
        "mortgageConfig": mortgage_config_to_api(mortgage_cfg) if mortgage_cfg else None,
        "mortgageProgress": mortgage_progress if mortgage_progress.get("ok") else None,
        "insuranceByYear": mortgage_progress.get("insuranceByYear", []) if mortgage_progress.get("ok") else [],
        "kvartplataMonthly": kvart_monthly,
        "kvartplataStats": stats_for_amounts(kvart_amounts),
        "repairMonthly": repair_monthly,
        "repairStats": stats_for_amounts([item["total"] for item in repair_monthly]),
    }


def yearly_bucket_totals(
    conn: psycopg.Connection,
    asset_id: int,
    bucket: str,
) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT EXTRACT(YEAR FROM tx_date)::int AS yr, SUM(amount) AS total
        FROM ledger_allocations
        WHERE asset_id = %s AND bucket = %s
        GROUP BY 1
        ORDER BY 1
        """,
        (asset_id, bucket),
    ).fetchall()
    return [{"year": int(r["yr"]), "total": round_money(r["total"])} for r in rows]


def build_car_service_summary(
    conn: psycopg.Connection,
    asset_id: int,
    year: int,
) -> dict[str, Any]:
    asset = get_asset(conn, asset_id)
    if not asset or asset["kind"] != "car":
        return {"ok": False, "error": "Объект не найден или не автомобиль"}

    d_from, d_to = year_bounds(year)
    rows = conn.execute(
        """
        SELECT sub_bucket, purpose, amount, label, tx_date
        FROM ledger_allocations
        WHERE asset_id = %s AND bucket = 'service' AND tx_date BETWEEN %s AND %s
        ORDER BY tx_date
        """,
        (asset_id, d_from, d_to),
    ).fetchall()

    amounts = [num(r["amount"]) for r in rows]
    by_unit: dict[str, list[float]] = {}
    by_purpose: dict[str, list[float]] = {}
    for row in rows:
        unit = normalize_service_unit(row.get("sub_bucket"))
        purpose = normalize_service_purpose(row.get("purpose"), sub_bucket=unit)
        amount = num(row["amount"])
        by_unit.setdefault(unit, []).append(amount)
        by_purpose.setdefault(purpose, []).append(amount)

    monthly = monthly_totals(conn, asset_id, "service", year)
    month_amounts = [num(m["total"]) for m in monthly]

    return {
        "ok": True,
        "asset": asset_to_api(asset),
        "year": year,
        "overall": stats_for_amounts(amounts),
        "yearStats": stats_for_amounts(month_amounts),
        "byUnit": {key: stats_for_amounts(vals) for key, vals in sorted(by_unit.items())},
        "byPurposeGroup": {
            key: stats_for_amounts(vals) for key, vals in sorted(by_purpose.items())
        },
        "bySubBucket": {
            key: stats_for_amounts(vals) for key, vals in sorted(by_unit.items())
        },
        "byPurpose": {
            key: stats_for_amounts(vals) for key, vals in sorted(by_purpose.items())
        },
        "monthly": monthly,
        "yearlyTotals": yearly_bucket_totals(conn, asset_id, "service"),
        "items": [
            {
                "txDate": r["tx_date"].isoformat(),
                "amount": round_money(r["amount"]),
                "label": r.get("label"),
                "subBucket": normalize_service_unit(r.get("sub_bucket")),
                "purpose": normalize_service_purpose(r.get("purpose"), sub_bucket=r.get("sub_bucket")),
            }
            for r in rows
        ],
    }


def build_car_consumables_summary(
    conn: psycopg.Connection,
    asset_id: int,
    year: int,
) -> dict[str, Any]:
    asset = get_asset(conn, asset_id)
    if not asset or asset["kind"] != "car":
        return {"ok": False, "error": "Объект не найден или не автомобиль"}

    d_from, d_to = year_bounds(year)
    rows = conn.execute(
        """
        SELECT tx_date, sub_bucket, amount, label,
               to_char(tx_date, 'YYYY-MM') AS year_month
        FROM ledger_allocations
        WHERE asset_id = %s AND bucket = 'consumables' AND tx_date BETWEEN %s AND %s
        ORDER BY tx_date
        """,
        (asset_id, d_from, d_to),
    ).fetchall()

    monthly: dict[str, dict[str, float]] = {}
    by_sub_monthly: dict[str, dict[str, float]] = {}
    month_comments: dict[str, str] = {}
    month_totals: list[float] = []
    for row in rows:
        ym = row["year_month"]
        sub = row.get("sub_bucket") or "misc"
        amount = num(row["amount"])
        monthly.setdefault(ym, {})
        monthly[ym][sub] = round_money(monthly[ym].get(sub, 0) + amount)
        by_sub_monthly.setdefault(sub, {})
        by_sub_monthly[sub][ym] = round_money(by_sub_monthly[sub].get(ym, 0) + amount)
        if row.get("label"):
            month_comments[ym] = row["label"]

    pivot = []
    for ym in sorted(monthly):
        vals = monthly[ym]
        total = round_money(sum(vals.values()))
        month_totals.append(total)
        pivot.append(
            {
                "yearMonth": ym,
                "breakdown": vals,
                "total": total,
                "comment": month_comments.get(ym),
            }
        )

    by_sub_bucket: dict[str, Any] = {}
    for sub, months in sorted(by_sub_monthly.items()):
        amounts = [months[ym] for ym in sorted(months)]
        by_sub_bucket[sub] = {
            "yearStats": stats_for_amounts(amounts),
            "monthly": [
                {"yearMonth": ym, "total": months[ym]} for ym in sorted(months)
            ],
        }

    # Транспортный налог: оплата за прошлый год → группируем по purpose (год налога).
    tax_yearly_rows = conn.execute(
        """
        SELECT
            COALESCE(NULLIF(TRIM(purpose), ''), to_char(tx_date, 'YYYY')) AS tax_year,
            COALESCE(SUM(amount), 0) AS total
        FROM ledger_allocations
        WHERE asset_id = %s
          AND bucket = 'consumables'
          AND sub_bucket = 'transport_tax'
        GROUP BY 1
        ORDER BY 1
        """,
        (asset_id,),
    ).fetchall()
    tax_yearly = []
    for row in tax_yearly_rows:
        try:
            tax_year = int(str(row["tax_year"])[:4])
        except (TypeError, ValueError):
            continue
        tax_yearly.append(
            {
                "year": tax_year,
                "total": round_money(row["total"]),
            }
        )

    return {
        "ok": True,
        "asset": asset_to_api(asset),
        "year": year,
        "monthly": pivot,
        "yearStats": stats_for_amounts(month_totals),
        "bySubBucket": by_sub_bucket,
        "transportTaxYearly": tax_yearly,
    }


def build_car_reminders(conn: psycopg.Connection, asset_id: int) -> dict[str, Any]:
    asset = get_asset(conn, asset_id)
    if not asset or asset["kind"] != "car":
        return {"ok": False, "error": "Объект не найден или не автомобиль"}

    rows = conn.execute(
        """
        SELECT *
        FROM ledger_maintenance_events
        WHERE asset_id = %s
        ORDER BY done_date DESC, id DESC
        """,
        (asset_id,),
    ).fetchall()

    current_km = asset.get("current_odometer_km")
    events = [maintenance_to_api(r, asset) for r in rows]
    upcoming = []
    for row in rows:
        next_km = row.get("next_odometer_km")
        if next_km is None:
            continue
        remaining = None
        if current_km is not None:
            remaining = int(next_km) - int(current_km)
        upcoming.append(
            {
                "kind": row["kind"],
                "label": row["label"],
                "nextOdometerKm": next_km,
                "remainingKm": remaining,
                "lastDoneDate": row["done_date"].isoformat(),
            }
        )

    return {
        "ok": True,
        "asset": asset_to_api(asset),
        "events": events,
        "upcoming": upcoming,
    }


def build_car_tech(conn: psycopg.Connection, asset_id: int) -> dict[str, Any]:
    asset = get_asset(conn, asset_id)
    if not asset or asset["kind"] != "car":
        return {"ok": False, "error": "Объект не найден или не автомобиль"}

    maint_rows = conn.execute(
        """
        SELECT kind, last_odometer_km, interval_km
        FROM ledger_car_maintenance
        WHERE asset_id = %s
        ORDER BY kind
        """,
        (asset_id,),
    ).fetchall()

    current_km = asset.get("current_odometer_km")
    maintenance = []
    for row in maint_rows:
        last_km = int(row["last_odometer_km"])
        interval_km = int(row["interval_km"])
        next_km = last_km + interval_km
        remaining_km = None
        if current_km is not None:
            remaining_km = next_km - int(current_km)
        kind = row["kind"]
        maintenance.append(
            {
                "kind": kind,
                "label": CAR_MAINTENANCE_LABELS.get(kind, kind),
                "lastOdometerKm": last_km,
                "intervalKm": interval_km,
                "nextOdometerKm": next_km,
                "remainingKm": remaining_km,
            }
        )

    year_rows = conn.execute(
        """
        SELECT period_end, km_driven
        FROM ledger_car_mileage_years
        WHERE asset_id = %s
        ORDER BY period_end
        """,
        (asset_id,),
    ).fetchall()

    purchase_km = asset.get("purchase_odometer_km")
    purchase_date = asset.get("purchase_date")
    stored_api, mileage_years = build_car_mileage_years(
        purchase_km=int(purchase_km) if purchase_km is not None else None,
        purchase_date=purchase_date,
        stored_rows=[dict(r) for r in year_rows],
        current_km=int(current_km) if current_km is not None else None,
    )

    return {
        "ok": True,
        "asset": asset_to_api(asset),
        "maintenance": maintenance,
        "mileageYearsStored": stored_api,
        "mileageYears": mileage_years,
    }


def get_loan_config(conn: psycopg.Connection, asset_id: int) -> dict[str, Any]:
    asset = get_asset(conn, asset_id)
    if not validate_loan_config_asset(asset):
        return {"ok": False, "error": "Объект не найден или кредит недоступен для этого типа"}
    row = conn.execute(
        "SELECT * FROM ledger_mortgage_config WHERE asset_id = %s",
        (asset_id,),
    ).fetchone()
    paid_loan = conn.execute(
        """
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM ledger_allocations
        WHERE asset_id = %s AND bucket = %s
        """,
        (asset_id, "loan" if asset["kind"] == "car" else "mortgage"),
    ).fetchone()
    return {
        "ok": True,
        "asset": asset_to_api(asset),
        "config": mortgage_config_to_api(row) if row else None,
        "paidPrincipalHint": round_money(paid_loan["total"]) if paid_loan else 0.0,
        "metricsReady": False,
    }


def get_mortgage_config(conn: psycopg.Connection, asset_id: int) -> dict[str, Any]:
    return get_loan_config(conn, asset_id)
