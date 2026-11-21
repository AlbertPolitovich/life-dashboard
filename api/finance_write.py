"""Запись финансов: транзакции, план, напоминания."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

import psycopg

from finance_common import (
    _as_date,
    parse_positive_amount,
    round_money,
    transaction_to_api,
)


def _get_category(conn: psycopg.Connection, category_id: int) -> dict[str, Any] | None:
    return conn.execute(
        """
        SELECT id, slug, name, kind, group_name, color_key, is_fixed, is_system, sort_order
        FROM finance_categories
        WHERE id = %s
        """,
        (category_id,),
    ).fetchone()


def _parse_tx_date(body: dict[str, Any]) -> date | None:
    raw = str(body.get("txDate") or body.get("tx_date") or "").strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def _parse_income_note(body: dict[str, Any], kind: str) -> str | None:
    if kind not in ("income", "carryover"):
        if body.get("note") or body.get("incomeNote") or body.get("income_note"):
            return None  # signal error below
        return None
    raw = body.get("note") or body.get("incomeNote") or body.get("income_note")
    if raw is None:
        return None
    s = str(raw).strip()
    return s or None


def create_transaction(conn: psycopg.Connection, body: dict[str, Any]) -> dict[str, Any]:
    category_id_raw = body.get("categoryId") or body.get("category_id")
    try:
        category_id = int(category_id_raw)
    except (TypeError, ValueError):
        return {"ok": False, "error": "Укажите categoryId"}

    amount = parse_positive_amount(body.get("amount"))
    if amount is None:
        return {"ok": False, "error": "Некорректная сумма"}

    tx_date = _parse_tx_date(body)
    if tx_date is None:
        return {"ok": False, "error": "txDate: формат yyyy-MM-dd"}

    cat = _get_category(conn, category_id)
    if not cat:
        return {"ok": False, "error": "Категория не найдена"}

    expected_kind = body.get("kind")
    if expected_kind in ("income", "expense"):
        if expected_kind == "income" and cat["kind"] not in ("income", "carryover"):
            return {"ok": False, "error": "Категория не подходит для дохода"}
        if expected_kind == "expense" and cat["kind"] != "expense":
            return {"ok": False, "error": "Категория не подходит для расхода"}

    if cat["kind"] == "expense" and (
        body.get("note") or body.get("incomeNote") or body.get("income_note")
    ):
        return {"ok": False, "error": "Заметка допустима только для доходов"}

    income_note = _parse_income_note(body, cat["kind"])

    row = conn.execute(
        """
        INSERT INTO finance_transactions (tx_date, category_id, amount, income_note, source)
        VALUES (%s, %s, %s, %s, 'manual')
        RETURNING id, tx_date, category_id, amount, income_note, source, created_at
        """,
        (tx_date, category_id, Decimal(str(amount)), income_note),
    ).fetchone()
    return {"ok": True, "transaction": transaction_to_api(row, cat)}


def update_transaction(
    conn: psycopg.Connection,
    transaction_id: int,
    body: dict[str, Any],
) -> dict[str, Any]:
    existing = conn.execute(
        """
        SELECT t.id, t.tx_date, t.category_id, t.amount, t.income_note, t.source, t.created_at,
               c.slug, c.name, c.kind
        FROM finance_transactions t
        JOIN finance_categories c ON c.id = t.category_id
        WHERE t.id = %s
        """,
        (transaction_id,),
    ).fetchone()
    if not existing:
        return {"ok": False, "error": "Транзакция не найдена"}

    category_id = int(existing["category_id"])
    if "categoryId" in body or "category_id" in body:
        try:
            category_id = int(body.get("categoryId") or body.get("category_id"))
        except (TypeError, ValueError):
            return {"ok": False, "error": "Некорректный categoryId"}
    cat = _get_category(conn, category_id)
    if not cat:
        return {"ok": False, "error": "Категория не найдена"}

    tx_date = existing["tx_date"]
    if "txDate" in body or "tx_date" in body:
        parsed = _parse_tx_date(body)
        if parsed is None:
            return {"ok": False, "error": "txDate: формат yyyy-MM-dd"}
        tx_date = parsed

    amount = num_amount(existing["amount"])
    if "amount" in body:
        parsed_amount = parse_positive_amount(body.get("amount"))
        if parsed_amount is None:
            return {"ok": False, "error": "Некорректная сумма"}
        amount = parsed_amount

    if cat["kind"] == "expense" and (
        body.get("note") or body.get("incomeNote") or body.get("income_note")
    ):
        return {"ok": False, "error": "Заметка допустима только для доходов"}

    income_note = existing["income_note"]
    if "note" in body or "incomeNote" in body or "income_note" in body:
        if cat["kind"] == "expense":
            income_note = None
        else:
            income_note = _parse_income_note(body, cat["kind"])

    row = conn.execute(
        """
        UPDATE finance_transactions
        SET tx_date = %s, category_id = %s, amount = %s, income_note = %s
        WHERE id = %s
        RETURNING id, tx_date, category_id, amount, income_note, source, created_at
        """,
        (tx_date, category_id, Decimal(str(amount)), income_note, transaction_id),
    ).fetchone()
    return {"ok": True, "transaction": transaction_to_api(row, cat)}


def num_amount(v: Any) -> float:
    if isinstance(v, Decimal):
        return float(v)
    return float(v)


def delete_transaction(conn: psycopg.Connection, transaction_id: int) -> dict[str, Any]:
    row = conn.execute(
        "DELETE FROM finance_transactions WHERE id = %s RETURNING id",
        (transaction_id,),
    ).fetchone()
    if not row:
        return {"ok": False, "error": "Транзакция не найдена"}
    return {"ok": True}


def save_month_plan(conn: psycopg.Connection, body: dict[str, Any]) -> dict[str, Any]:
    month_raw = str(body.get("month") or "").strip()
    if len(month_raw) >= 7:
        year_month = month_raw[:7]
    else:
        return {"ok": False, "error": "month: формат yyyy-MM"}

    items = body.get("items") or []
    if not isinstance(items, list):
        return {"ok": False, "error": "items: массив"}

    written = 0
    for item in items:
        try:
            category_id = int(item.get("categoryId") or item.get("category_id"))
        except (TypeError, ValueError):
            continue
        planned = parse_positive_amount(item.get("amountPlanned") or item.get("amount_planned"))
        if planned is None:
            planned = 0.0
        cat = _get_category(conn, category_id)
        if not cat or cat["kind"] == "carryover":
            continue
        conn.execute(
            """
            INSERT INTO finance_monthly_plan (year_month, category_id, amount_planned, updated_at)
            VALUES (%s, %s, %s, now())
            ON CONFLICT (year_month, category_id)
            DO UPDATE SET amount_planned = EXCLUDED.amount_planned, updated_at = now()
            """,
            (year_month, category_id, Decimal(str(planned))),
        )
        written += 1

    return {"ok": True, "month": year_month, "itemsWritten": written}


def _parse_due_date(body: dict[str, Any]) -> date | None:
    raw = str(body.get("dueDate") or body.get("due_date") or "").strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        return None


def create_reminder(conn: psycopg.Connection, body: dict[str, Any]) -> dict[str, Any]:
    due_date = _parse_due_date(body)
    day_of_month = None
    if due_date is not None:
        day_of_month = due_date.day
    else:
        try:
            day_of_month = int(body.get("dayOfMonth") or body.get("day_of_month"))
        except (TypeError, ValueError):
            return {"ok": False, "error": "Укажите dueDate (yyyy-MM-dd)"}
    if day_of_month is None or not 1 <= day_of_month <= 31:
        return {"ok": False, "error": "dayOfMonth: от 1 до 31"}

    label = str(body.get("label") or "").strip()
    if not label:
        return {"ok": False, "error": "Укажите label"}

    category_id = None
    if body.get("categoryId") or body.get("category_id"):
        try:
            category_id = int(body.get("categoryId") or body.get("category_id"))
        except (TypeError, ValueError):
            return {"ok": False, "error": "Некорректный categoryId"}
        if not _get_category(conn, category_id):
            return {"ok": False, "error": "Категория не найдена"}

    amount_hint = None
    if body.get("amountHint") is not None or body.get("amount_hint") is not None:
        amount_hint = parse_positive_amount(body.get("amountHint") or body.get("amount_hint"))
        if amount_hint is None:
            return {"ok": False, "error": "Некорректный amountHint"}

    is_active = body.get("isActive", body.get("is_active", True))
    is_active = bool(is_active)

    row = conn.execute(
        """
        INSERT INTO finance_reminders (day_of_month, due_date, category_id, label, amount_hint, is_active)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING id, day_of_month, due_date, label, amount_hint, is_active, category_id
        """,
        (
            day_of_month,
            due_date,
            category_id,
            label,
            Decimal(str(amount_hint)) if amount_hint else None,
            is_active,
        ),
    ).fetchone()

    cat = _get_category(conn, int(row["category_id"])) if row["category_id"] else None
    return {
        "ok": True,
        "reminder": _reminder_row_to_api(row, cat),
    }


def update_reminder(
    conn: psycopg.Connection,
    reminder_id: int,
    body: dict[str, Any],
) -> dict[str, Any]:
    existing = conn.execute(
        "SELECT id, day_of_month, due_date, label, amount_hint, is_active, category_id FROM finance_reminders WHERE id = %s",
        (reminder_id,),
    ).fetchone()
    if not existing:
        return {"ok": False, "error": "Напоминание не найдено"}

    due_date = _as_date(existing["due_date"])
    day_of_month = int(existing["day_of_month"])
    if "dueDate" in body or "due_date" in body:
        parsed = _parse_due_date(body)
        if parsed is None and (body.get("dueDate") or body.get("due_date")):
            return {"ok": False, "error": "dueDate: формат yyyy-MM-dd"}
        if parsed is not None:
            day_of_month = parsed.day
            due_date = parsed
    elif "dayOfMonth" in body or "day_of_month" in body:
        try:
            day_of_month = int(body.get("dayOfMonth") or body.get("day_of_month"))
        except (TypeError, ValueError):
            return {"ok": False, "error": "dayOfMonth: от 1 до 31"}
        if not 1 <= day_of_month <= 31:
            return {"ok": False, "error": "dayOfMonth: от 1 до 31"}

    label = existing["label"]
    if "label" in body:
        label = str(body.get("label") or "").strip()
        if not label:
            return {"ok": False, "error": "label не может быть пустым"}

    category_id = existing["category_id"]
    if "categoryId" in body or "category_id" in body:
        raw = body.get("categoryId") or body.get("category_id")
        if raw is None:
            category_id = None
        else:
            try:
                category_id = int(raw)
            except (TypeError, ValueError):
                return {"ok": False, "error": "Некорректный categoryId"}
            if not _get_category(conn, category_id):
                return {"ok": False, "error": "Категория не найдена"}

    amount_hint = existing["amount_hint"]
    if "amountHint" in body or "amount_hint" in body:
        raw = body.get("amountHint") if "amountHint" in body else body.get("amount_hint")
        if raw is None:
            amount_hint = None
        else:
            parsed = parse_positive_amount(raw)
            if parsed is None:
                return {"ok": False, "error": "Некорректный amountHint"}
            amount_hint = Decimal(str(parsed))

    is_active = bool(existing["is_active"])
    if "isActive" in body or "is_active" in body:
        is_active = bool(body.get("isActive", body.get("is_active")))

    row = conn.execute(
        """
        UPDATE finance_reminders
        SET day_of_month = %s, due_date = %s, category_id = %s, label = %s, amount_hint = %s, is_active = %s
        WHERE id = %s
        RETURNING id, day_of_month, due_date, label, amount_hint, is_active, category_id
        """,
        (day_of_month, due_date, category_id, label, amount_hint, is_active, reminder_id),
    ).fetchone()
    cat = _get_category(conn, int(row["category_id"])) if row["category_id"] else None
    return {"ok": True, "reminder": _reminder_row_to_api(row, cat)}


def delete_reminder(conn: psycopg.Connection, reminder_id: int) -> dict[str, Any]:
    row = conn.execute(
        "DELETE FROM finance_reminders WHERE id = %s RETURNING id",
        (reminder_id,),
    ).fetchone()
    if not row:
        return {"ok": False, "error": "Напоминание не найдено"}
    return {"ok": True}


def _reminder_row_to_api(row: dict[str, Any], cat: dict[str, Any] | None) -> dict[str, Any]:
    from finance_common import reminder_to_api

    out = reminder_to_api(
        {
            **row,
            "category_slug": cat["slug"] if cat else None,
            "category_name": cat["name"] if cat else None,
        }
    )
    return out
