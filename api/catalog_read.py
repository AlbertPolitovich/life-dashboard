"""Чтение общего каталога из food (+ cook_kind из food_categories). Single-user."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import psycopg

from bju_score import bju_score_fields
from nutrition_common import (
    HIDDEN_FOOD_USER_ID,
    infer_cook_kind_from_name,
    should_skip_cook_kind,
    suggested_serving_grams,
)
from search_text import expand_search_token_groups

FOOD_SELECT = """
    f.id, f.source, f.name, f.manufacturer_name,
    f.kcal_per_100g, f.protein_per_100g, f.fat_per_100g,
    f.carbs_per_100g, f.fiber_per_100g,
    COALESCE(f.cook_kind, fc.cook_kind) AS cook_kind,
    fc.slug AS category_slug
"""


def _num(v: Any) -> float | None:
    if v is None:
        return None
    if isinstance(v, Decimal):
        return float(v)
    return float(v)


def catalog_row_to_api(row: dict[str, Any]) -> dict[str, Any]:
    cook_kind = row.get("cook_kind")
    name = row.get("name") or ""
    # eggs/хлеб/фрукты: без чипов; авокадо в vegetables иначе → veg.
    if should_skip_cook_kind(name, row.get("category_slug")):
        cook_kind = None
    elif not cook_kind:
        cook_kind = infer_cook_kind_from_name(name)
    out: dict[str, Any] = {
        "id": int(row["id"]),
        "name": row["name"],
        "source": row.get("source") or "",
        "manufacturerName": row.get("manufacturer_name"),
        "kcalPer100g": _num(row.get("kcal_per_100g")),
        "proteinPer100g": _num(row.get("protein_per_100g")),
        "fatPer100g": _num(row.get("fat_per_100g")),
        "carbsPer100g": _num(row.get("carbs_per_100g")),
        "fiberPer100g": _num(row.get("fiber_per_100g")),
        "categorySlug": row.get("category_slug"),
        "fromCatalog": True,
        "foodId": int(row["id"]),
    }
    if cook_kind:
        out["cookKind"] = cook_kind
    out.update(
        bju_score_fields(
            kcal=out["kcalPer100g"],
            protein=out["proteinPer100g"],
            fat=out["fatPer100g"],
            carbs=out["carbsPer100g"],
            fiber=out["fiberPer100g"],
        )
    )
    suggested = suggested_serving_grams(
        name,
        source=row.get("source"),
        category_slug=row.get("category_slug"),
    )
    if suggested is not None:
        out["suggestedServingGrams"] = suggested
    return out


def _search_rank_sql(n_variants: int) -> tuple[str, str]:
    exact_parts: list[str] = []
    prefix_parts: list[str] = []
    word_parts: list[str] = []
    pos_parts: list[str] = []
    for _ in range(n_variants):
        exact_parts.append("lower(f.name) = lower(%s)")
        prefix_parts.append("f.name ILIKE %s")
        word_parts.append(
            "(f.name ILIKE %s OR f.name ILIKE %s OR f.name ILIKE %s OR f.name ILIKE %s)"
        )
        pos_parts.append("NULLIF(POSITION(lower(%s) IN lower(f.name)), 0)")
    rank = f"""
        CASE
          WHEN {" OR ".join(exact_parts)} THEN 0
          WHEN {" OR ".join(prefix_parts)} THEN 1
          WHEN {" OR ".join(word_parts)} THEN 2
          ELSE 3
        END
    """
    position = f"LEAST({', '.join(pos_parts)}, 9999)"
    return rank, position


def list_catalog_products(
    conn: psycopg.Connection,
    query: str = "",
    limit: int = 40,
    source: str | None = None,
) -> list[dict[str, Any]]:
    q = (query or "").strip()
    lim = max(1, min(int(limit), 100))
    params: list[Any] = []
    where = [
        "(f.kcal_per_100g IS NOT NULL OR f.protein_per_100g IS NOT NULL "
        "OR f.fat_per_100g IS NOT NULL OR f.carbs_per_100g IS NOT NULL)"
    ]
    if source:
        where.append("f.source = %s")
        params.append(source)
    where.append(
        "NOT EXISTS ("
        "SELECT 1 FROM user_hidden_food uhf "
        "WHERE uhf.user_id = %s AND uhf.food_id = f.id"
        ")"
    )
    params.append(HIDDEN_FOOD_USER_ID)
    if q:
        primary, token_groups = expand_search_token_groups(q)
        if token_groups:
            for terms in token_groups:
                where.append("(" + " OR ".join(["f.name ILIKE %s"] * len(terms)) + ")")
                params.extend(f"%{v}%" for v in terms)

            rank_sql, pos_sql = _search_rank_sql(len(primary))
            order = f"{rank_sql}, {pos_sql}, length(f.name), f.name"
            params.extend(primary)
            params.extend(f"{v}%" for v in primary)
            for v in primary:
                params.extend((f"% {v}%", f'%"{v}%', f"%«{v}%", f"%({v}%"))
            params.extend(v.lower() for v in primary)
        else:
            order = "f.name"
    else:
        order = "f.name"
    params.append(lim)
    sql = f"""
        SELECT {FOOD_SELECT}
        FROM food f
        LEFT JOIN food_categories fc ON fc.id = f.category_id
        WHERE {" AND ".join(where)}
        ORDER BY {order}
        LIMIT %s
    """
    rows = conn.execute(sql, params).fetchall()
    return [catalog_row_to_api(dict(r)) for r in rows]


def get_catalog_product(conn: psycopg.Connection, catalog_id: int) -> dict[str, Any] | None:
    row = conn.execute(
        f"""
        SELECT {FOOD_SELECT}
        FROM food f
        LEFT JOIN food_categories fc ON fc.id = f.category_id
        WHERE f.id = %s
        """,
        (catalog_id,),
    ).fetchone()
    return dict(row) if row else None


def get_catalog_product_api(conn: psycopg.Connection, catalog_id: int) -> dict[str, Any] | None:
    cat = get_catalog_product(conn, catalog_id)
    if not cat:
        return None
    hidden = conn.execute(
        """
        SELECT 1 FROM user_hidden_food
        WHERE user_id = %s AND food_id = %s
        """,
        (HIDDEN_FOOD_USER_ID, catalog_id),
    ).fetchone()
    if hidden:
        return None
    out = catalog_row_to_api(cat)
    pref = conn.execute(
        "SELECT last_serving_grams FROM food_preferences WHERE food_id = %s",
        (catalog_id,),
    ).fetchone()
    if pref and pref["last_serving_grams"] is not None:
        out["lastServingGrams"] = float(pref["last_serving_grams"])
    from item_meta import fetch_meta_fields

    out.update(fetch_meta_fields(conn, food_id=catalog_id))
    return out
