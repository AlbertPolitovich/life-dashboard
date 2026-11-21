"""Избранное и заметки по food / product (nutrition_item_meta). Single-user."""

from __future__ import annotations

from typing import Any

import psycopg


def _normalize_note(raw: Any) -> str | None:
    if raw is None:
        return None
    text = str(raw).strip()
    return text or None


def _resolve_ids(
    food_id: int | None,
    product_id: int | None,
) -> tuple[int | None, int | None] | str:
    has_food = food_id is not None and int(food_id) > 0
    has_product = product_id is not None and int(product_id) > 0
    if has_food == has_product:
        return "Укажите ровно одно: foodId или productId"
    if has_food:
        return int(food_id), None  # type: ignore[arg-type]
    return None, int(product_id)  # type: ignore[arg-type]


def meta_to_api(
    row: dict[str, Any] | None, *, food_id: int | None, product_id: int | None
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "favorite": bool(row["is_favorite"]) if row else False,
        "note": (row["note"] if row and row.get("note") else None),
    }
    if food_id is not None:
        out["foodId"] = int(food_id)
    if product_id is not None:
        out["productId"] = int(product_id)
    return out


def get_item_meta(
    conn: psycopg.Connection,
    *,
    food_id: int | None = None,
    product_id: int | None = None,
) -> dict[str, Any] | str:
    resolved = _resolve_ids(food_id, product_id)
    if isinstance(resolved, str):
        return resolved
    fid, pid = resolved

    if fid is not None:
        row = conn.execute(
            "SELECT is_favorite, note FROM nutrition_item_meta WHERE food_id = %s",
            (fid,),
        ).fetchone()
        return meta_to_api(dict(row) if row else None, food_id=fid, product_id=None)

    row = conn.execute(
        "SELECT is_favorite, note FROM nutrition_item_meta WHERE product_id = %s",
        (pid,),
    ).fetchone()
    return meta_to_api(dict(row) if row else None, food_id=None, product_id=pid)


def fetch_meta_fields(
    conn: psycopg.Connection,
    *,
    food_id: int | None = None,
    product_id: int | None = None,
) -> dict[str, Any]:
    meta = get_item_meta(conn, food_id=food_id, product_id=product_id)
    if isinstance(meta, str):
        return {"favorite": False, "note": None}
    return {"favorite": meta["favorite"], "note": meta["note"]}


def upsert_item_meta(
    conn: psycopg.Connection,
    *,
    food_id: int | None = None,
    product_id: int | None = None,
    favorite: bool | None = None,
    note: Any = ...,
) -> dict[str, Any]:
    resolved = _resolve_ids(food_id, product_id)
    if isinstance(resolved, str):
        return {"ok": False, "error": resolved}
    fid, pid = resolved

    if fid is not None:
        exists = conn.execute("SELECT 1 FROM food WHERE id = %s", (fid,)).fetchone()
        if not exists:
            return {"ok": False, "error": "Продукт каталога не найден"}
    else:
        exists = conn.execute("SELECT 1 FROM products WHERE id = %s", (pid,)).fetchone()
        if not exists:
            return {"ok": False, "error": "Продукт не найден"}

    current = get_item_meta(conn, food_id=fid, product_id=pid)
    assert not isinstance(current, str)
    new_favorite = current["favorite"] if favorite is None else bool(favorite)
    new_note = current["note"] if note is ... else _normalize_note(note)

    if not new_favorite and new_note is None:
        if fid is not None:
            conn.execute("DELETE FROM nutrition_item_meta WHERE food_id = %s", (fid,))
        else:
            conn.execute("DELETE FROM nutrition_item_meta WHERE product_id = %s", (pid,))
        return {"ok": True, **meta_to_api(None, food_id=fid, product_id=pid)}

    if fid is not None:
        updated = conn.execute(
            """
            UPDATE nutrition_item_meta
            SET is_favorite = %s, note = %s, updated_at = now()
            WHERE food_id = %s
            """,
            (new_favorite, new_note, fid),
        )
        if updated.rowcount == 0:
            conn.execute(
                """
                INSERT INTO nutrition_item_meta (food_id, product_id, is_favorite, note)
                VALUES (%s, NULL, %s, %s)
                """,
                (fid, new_favorite, new_note),
            )
    else:
        updated = conn.execute(
            """
            UPDATE nutrition_item_meta
            SET is_favorite = %s, note = %s, updated_at = now()
            WHERE product_id = %s
            """,
            (new_favorite, new_note, pid),
        )
        if updated.rowcount == 0:
            conn.execute(
                """
                INSERT INTO nutrition_item_meta (food_id, product_id, is_favorite, note)
                VALUES (NULL, %s, %s, %s)
                """,
                (pid, new_favorite, new_note),
            )

    return {
        "ok": True,
        **meta_to_api(
            {"is_favorite": new_favorite, "note": new_note},
            food_id=fid,
            product_id=pid,
        ),
    }


def list_favorites(conn: psycopg.Connection, limit: int = 80) -> list[dict[str, Any]]:
    from catalog_read import get_catalog_product_api
    from nutrition_common import HIDDEN_FOOD_USER_ID
    from nutrition_read import get_product_by_id

    lim = max(1, min(int(limit), 200))
    rows = conn.execute(
        """
        SELECT
            m.food_id,
            m.product_id,
            m.is_favorite,
            m.note,
            m.updated_at,
            COALESCE(fp.updated_at, p.updated_at) AS last_used_at
        FROM nutrition_item_meta m
        LEFT JOIN food_preferences fp ON fp.food_id = m.food_id
        LEFT JOIN products p
            ON p.id = m.product_id AND p.last_serving_grams IS NOT NULL
        WHERE m.is_favorite
        ORDER BY
            COALESCE(fp.updated_at, p.updated_at, '-infinity'::timestamptz) DESC,
            m.updated_at DESC
        LIMIT %s
        """,
        (lim,),
    ).fetchall()

    out: list[dict[str, Any]] = []
    for r in rows:
        d = dict(r)
        if d["food_id"] is not None:
            item = get_catalog_product_api(conn, int(d["food_id"]))
            if not item:
                hide = conn.execute(
                    """
                    SELECT product_id FROM user_hidden_food
                    WHERE user_id = %s AND food_id = %s
                    """,
                    (HIDDEN_FOOD_USER_ID, int(d["food_id"])),
                ).fetchone()
                if not hide:
                    continue
                item = get_product_by_id(conn, int(hide["product_id"]))
                if not item:
                    continue
            else:
                item["foodId"] = int(d["food_id"])
            item["favorite"] = True
            item["note"] = d.get("note")
            out.append(item)
        else:
            item = get_product_by_id(conn, int(d["product_id"]))
            if not item:
                continue
            item["favorite"] = True
            item["note"] = d.get("note")
            out.append(item)
    return out
