"""Чтение дневника: месяц (календарь) и один день."""

from __future__ import annotations

from datetime import date, timedelta

import psycopg

from diary_common import (
    days_in_month,
    extract_hashtags,
    extract_wiki_links,
    month_elapsed_days,
    normalize_diary_body,
)
from finance_common import month_bounds


def _row_date_iso(value: object) -> str:
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def build_diary_month_payload(
    conn: psycopg.Connection,
    year_month: str,
    *,
    today: date | None = None,
) -> dict:
    ref = today or date.today()
    start, end = month_bounds(year_month)

    rows = conn.execute(
        """
        SELECT entry_date
        FROM diary_entries
        WHERE entry_date >= %s AND entry_date <= %s
          AND btrim(body) <> ''
        ORDER BY entry_date
        """,
        (start, end),
    ).fetchall()

    filled_dates = [_row_date_iso(r["entry_date"]) for r in rows]
    filled_set = set(filled_dates)
    elapsed = month_elapsed_days(year_month, ref)
    today_iso = ref.isoformat()
    filled_in_elapsed = sum(1 for d in filled_dates if d <= today_iso)
    unfilled_elapsed = max(0, elapsed - filled_in_elapsed)

    last_row = conn.execute(
        """
        SELECT entry_date
        FROM diary_entries
        WHERE btrim(body) <> ''
        ORDER BY entry_date DESC
        LIMIT 1
        """
    ).fetchone()
    last_entry_date = (
        _row_date_iso(last_row["entry_date"]) if last_row else None
    )

    return {
        "ok": True,
        "month": year_month,
        "daysInMonth": days_in_month(year_month),
        "elapsedDays": elapsed,
        "filledCount": len(filled_dates),
        "unfilledElapsed": unfilled_elapsed,
        "filledDates": filled_dates,
        "today": today_iso,
        "todayFilled": today_iso in filled_set,
        "lastEntryDate": last_entry_date,
    }


def build_diary_day_payload(conn: psycopg.Connection, day_iso: str) -> dict:
    row = conn.execute(
        """
        SELECT entry_date, body, created_at, updated_at
        FROM diary_entries
        WHERE entry_date = %s
        """,
        (day_iso,),
    ).fetchone()

    if row is None:
        return {
            "ok": True,
            "date": day_iso,
            "month": day_iso[:7],
            "hasEntry": False,
            "body": "",
            "createdAt": None,
            "updatedAt": None,
        }

    body = normalize_diary_body(row["body"])
    has_entry = bool(body.strip())

    return {
        "ok": True,
        "date": day_iso,
        "month": day_iso[:7],
        "hasEntry": has_entry,
        "body": body,
        "createdAt": row["created_at"].isoformat() if row["created_at"] else None,
        "updatedAt": row["updated_at"].isoformat() if row["updated_at"] else None,
    }


def _token_list_from_map(by_key: dict[str, dict]) -> list[dict]:
    items = list(by_key.values())
    items.sort(key=lambda x: (x["lastUsed"], x["text"].lower()), reverse=True)
    return items


def build_diary_suggest_tokens(
    conn: psycopg.Connection,
    *,
    days: int = 40,
    today: date | None = None,
) -> dict:
    """Теги и [[wiki]] из записей за последние `days` дней (для предложки)."""
    ref = today or date.today()
    window = max(1, min(int(days), 120))
    since = ref - timedelta(days=window - 1)

    rows = conn.execute(
        """
        SELECT entry_date, body
        FROM diary_entries
        WHERE entry_date >= %s AND entry_date <= %s
          AND btrim(body) <> ''
        ORDER BY entry_date ASC
        """,
        (since, ref),
    ).fetchall()

    wiki_by: dict[str, dict] = {}
    tag_by: dict[str, dict] = {}

    for row in rows:
        day_iso = _row_date_iso(row["entry_date"])
        body = normalize_diary_body(row["body"])
        for label in extract_wiki_links(body):
            key = label.casefold()
            prev = wiki_by.get(key)
            if prev is None or day_iso >= prev["lastUsed"]:
                wiki_by[key] = {"text": label, "lastUsed": day_iso}
        for tag in extract_hashtags(body):
            key = tag.casefold()
            prev = tag_by.get(key)
            if prev is None or day_iso >= prev["lastUsed"]:
                tag_by[key] = {"text": tag, "lastUsed": day_iso}

    return {
        "ok": True,
        "days": window,
        "since": since.isoformat(),
        "wikiLinks": _token_list_from_map(wiki_by),
        "hashtags": _token_list_from_map(tag_by),
    }
