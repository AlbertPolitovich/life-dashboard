"""Запись дневника за один день."""

from __future__ import annotations

import re
from typing import Any

import psycopg

from diary_common import normalize_diary_body

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def save_diary_day(conn: psycopg.Connection, body: dict[str, Any]) -> dict:
    day_iso = str(body.get("date") or "").strip()
    if not DATE_RE.match(day_iso):
        return {"ok": False, "error": "date: формат yyyy-MM-dd"}

    text = normalize_diary_body(body.get("body"))

    if not text.strip():
        conn.execute("DELETE FROM diary_entries WHERE entry_date = %s", (day_iso,))
        return {
            "ok": True,
            "date": day_iso,
            "month": day_iso[:7],
            "hasEntry": False,
            "body": "",
            "deleted": True,
        }

    row = conn.execute(
        """
        INSERT INTO diary_entries (entry_date, body, updated_at)
        VALUES (%s, %s, now())
        ON CONFLICT (entry_date)
        DO UPDATE SET body = EXCLUDED.body, updated_at = now()
        RETURNING entry_date, body, created_at, updated_at
        """,
        (day_iso, text),
    ).fetchone()

    return {
        "ok": True,
        "date": day_iso,
        "month": day_iso[:7],
        "hasEntry": True,
        "body": normalize_diary_body(row["body"]),
        "createdAt": row["created_at"].isoformat() if row["created_at"] else None,
        "updatedAt": row["updated_at"].isoformat() if row["updated_at"] else None,
        "deleted": False,
    }


def delete_diary_day(conn: psycopg.Connection, day_iso: str) -> dict:
    if not DATE_RE.match(day_iso):
        return {"ok": False, "error": "date: формат yyyy-MM-dd"}

    row = conn.execute(
        "DELETE FROM diary_entries WHERE entry_date = %s RETURNING entry_date",
        (day_iso,),
    ).fetchone()

    return {
        "ok": True,
        "date": day_iso,
        "month": day_iso[:7],
        "hasEntry": False,
        "body": "",
        "deleted": row is not None,
    }
