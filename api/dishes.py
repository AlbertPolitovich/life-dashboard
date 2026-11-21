"""Блюда: КБЖУ из ингредиентов + готовка, снимок в products (Мои). Single-user."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import psycopg

from catalog_read import get_catalog_product
from item_meta import fetch_meta_fields, upsert_item_meta
from nutrition_common import (
    PRODUCT_SELECT_COLS,
    cooked_grams_from_raw,
    is_fry_cook_mode,
    macro_for_grams,
    normalize_cook_mode,
    normalize_product_name,
    parse_grams_input,
    parse_positive_number,
    product_row_to_api,
)

OIL_KCAL_PER_G = 9.0
_MACRO_KEYS = ("kcal", "protein", "fat", "carbs", "fiber")


def dish_item_macros(
    per_100: dict[str, Any],
    weighed: float,
    cook_mode: str,
    oil_grams: float = 0.0,
) -> dict[str, float]:
    """КБЖУ от сырого/сухого веса в блюдо. Готовка меняет выход, не белок."""
    part = macro_for_grams(per_100, weighed)
    oil = max(0.0, float(oil_grams or 0))
    if oil > 0 and is_fry_cook_mode(cook_mode):
        part["kcal"] += oil * OIL_KCAL_PER_G
        part["fat"] += oil
    return part


def dish_item_cooked_mass(
    raw_grams: float,
    cook_mode: str,
    oil_grams: float = 0.0,
    *,
    product_name: str | None = None,
) -> float:
    cooked = cooked_grams_from_raw(raw_grams, cook_mode, product_name=product_name)
    if is_fry_cook_mode(cook_mode):
        cooked += max(0.0, float(oil_grams or 0))
    return round(cooked, 1)


def dish_yield_from_items(items: list[dict[str, Any]]) -> float:
    """Вес готового = сумма после готовки + масло, ушедшее в еду."""
    total = 0.0
    for item in items:
        total += dish_item_cooked_mass(
            float(item.get("grams") or 0),
            item.get("cookMode", item.get("cook_mode")),
            float(item.get("oilGrams", item.get("oil_grams")) or 0),
            product_name=item.get("name") or item.get("productName"),
        )
    return round(total, 1)


def dish_per_100g(totals: dict[str, float], yield_grams: float) -> dict[str, float]:
    if yield_grams <= 0:
        raise ValueError("yield_grams")
    scale = 100.0 / yield_grams
    return {k: round(float(totals.get(k) or 0) * scale, 1) for k in _MACRO_KEYS}


def _empty_totals() -> dict[str, float]:
    return {k: 0.0 for k in _MACRO_KEYS}


def _add_part(totals: dict[str, float], part: dict[str, float]) -> None:
    for k in _MACRO_KEYS:
        totals[k] += float(part.get(k) or 0)


def _parse_oil(raw: Any) -> float | None:
    if raw is None or raw == "":
        return 0.0
    v = parse_positive_number(raw)
    if v is None:
        return None
    return v


def _validate_items(raw_items: Any) -> tuple[list[dict[str, Any]], str | None]:
    if not isinstance(raw_items, list) or not raw_items:
        return [], "Добавьте хотя бы один ингредиент"
    items: list[dict[str, Any]] = []
    for idx, item in enumerate(raw_items, start=1):
        if not isinstance(item, dict):
            return [], f"Ингредиент #{idx}: некорректный формат"
        food_raw = item.get("foodId", item.get("food_id"))
        prod_raw = item.get("productId", item.get("product_id"))
        food_id = None
        product_id = None
        if food_raw not in (None, ""):
            try:
                food_id = int(food_raw)
            except (TypeError, ValueError):
                return [], f"Ингредиент #{idx}: некорректный foodId"
        if prod_raw not in (None, ""):
            try:
                product_id = int(prod_raw)
            except (TypeError, ValueError):
                return [], f"Ингредиент #{idx}: некорректный productId"
        if bool(food_id) == bool(product_id):
            return [], f"Ингредиент #{idx}: укажите продукт из базы или свой"
        grams = parse_grams_input(item.get("grams"))
        if grams is None:
            return [], f"Ингредиент #{idx}: укажите граммы (> 0)"
        oil = _parse_oil(item.get("oilGrams", item.get("oil_grams")))
        if oil is None:
            return [], f"Ингредиент #{idx}: некорректные граммы масла"
        cook_mode = normalize_cook_mode(item.get("cookMode", item.get("cook_mode")))
        if not is_fry_cook_mode(cook_mode):
            oil = 0.0
        items.append(
            {
                "foodId": food_id,
                "productId": product_id,
                "grams": grams,
                "cookMode": cook_mode,
                "oilGrams": oil,
            }
        )
    return items, None


def _load_ingredient(
    conn: psycopg.Connection, item: dict[str, Any], idx: int
) -> tuple[dict[str, Any] | None, str | None]:
    if item["foodId"]:
        cat = get_catalog_product(conn, int(item["foodId"]))
        if not cat:
            return None, f"Ингредиент #{idx}: продукт каталога не найден"
        return {
            "foodId": int(item["foodId"]),
            "productId": None,
            "name": cat["name"],
            "kcal_per_100g": cat.get("kcal_per_100g") or 0,
            "protein_per_100g": cat.get("protein_per_100g") or 0,
            "fat_per_100g": cat.get("fat_per_100g") or 0,
            "carbs_per_100g": cat.get("carbs_per_100g") or 0,
            "fiber_per_100g": cat.get("fiber_per_100g") or 0,
        }, None

    row = conn.execute(
        """
        SELECT id, name, is_dish,
               kcal_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g, fiber_per_100g
        FROM products
        WHERE id = %s
        """,
        (int(item["productId"]),),
    ).fetchone()
    if not row:
        return None, f"Ингредиент #{idx}: свой продукт не найден"
    if row.get("is_dish"):
        return None, f"Ингредиент #{idx}: блюдо нельзя добавить как ингредиент"
    return {
        "foodId": None,
        "productId": int(row["id"]),
        "name": row["name"],
        "kcal_per_100g": row.get("kcal_per_100g") or 0,
        "protein_per_100g": row.get("protein_per_100g") or 0,
        "fat_per_100g": row.get("fat_per_100g") or 0,
        "carbs_per_100g": row.get("carbs_per_100g") or 0,
        "fiber_per_100g": row.get("fiber_per_100g") or 0,
    }, None


def _resolve_dish_body(
    conn: psycopg.Connection, body: dict[str, Any]
) -> tuple[dict[str, Any] | None, str | None]:
    name = str(body.get("name") or "").strip()
    if not name:
        return None, "Укажите название блюда"
    items, err = _validate_items(body.get("items"))
    if err:
        return None, err

    yield_grams = dish_yield_from_items(items)
    if yield_grams <= 0:
        return None, "Укажите граммы ингредиентов"

    totals = _empty_totals()
    resolved: list[dict[str, Any]] = []
    for idx, item in enumerate(items, start=1):
        ing, ing_err = _load_ingredient(conn, item, idx)
        if ing_err:
            return None, ing_err
        assert ing is not None
        part = dish_item_macros(ing, item["grams"], item["cookMode"], item["oilGrams"])
        _add_part(totals, part)
        resolved.append({**item, **ing})

    per100 = dish_per_100g(totals, yield_grams)
    return {
        "name": name,
        "norm": normalize_product_name(name),
        "resolved": resolved,
        "totals": totals,
        "per100": per100,
        "yield_grams": yield_grams,
    }, None


def _replace_dish_items(
    conn: psycopg.Connection, product_id: int, resolved: list[dict[str, Any]]
) -> None:
    conn.execute("DELETE FROM dish_items WHERE product_id = %s", (product_id,))
    for i, item in enumerate(resolved):
        conn.execute(
            """
            INSERT INTO dish_items (
                product_id, food_id, ingredient_product_id,
                grams, cook_mode, oil_grams, sort_order
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                product_id,
                item["foodId"],
                item["productId"],
                Decimal(str(item["grams"])),
                item["cookMode"],
                Decimal(str(item["oilGrams"])),
                i,
            ),
        )


def _fetch_dish_product(conn: psycopg.Connection, product_id: int) -> dict[str, Any] | None:
    full = conn.execute(
        f"""
        SELECT {PRODUCT_SELECT_COLS}
        FROM products
        WHERE id = %s
        """,
        (product_id,),
    ).fetchone()
    if not full:
        return None
    product = product_row_to_api(dict(full))
    product.update(fetch_meta_fields(conn, product_id=int(product["id"])))
    return product


def _save_dish_note(conn: psycopg.Connection, product_id: int, body: dict[str, Any]) -> None:
    if "note" not in body:
        return
    upsert_item_meta(conn, product_id=product_id, note=body.get("note"))


def _dish_ok_payload(
    product: dict[str, Any],
    totals: dict[str, float],
    per100: dict[str, float],
    yield_grams: float,
) -> dict[str, Any]:
    return {
        "ok": True,
        "product": product,
        "totals": {k: round(v, 1) for k, v in totals.items()},
        "per100g": per100,
        "yieldGrams": round(yield_grams, 1),
    }


def _ingredient_api_row(conn: psycopg.Connection, row: dict[str, Any]) -> dict[str, Any] | None:
    from bju_score import bju_score_fields
    from nutrition_common import infer_cook_kind_from_name

    food_id = row.get("food_id")
    product_id = row.get("ingredient_product_id")
    grams = float(row.get("grams") or 0)
    cook_mode = normalize_cook_mode(row.get("cook_mode"))
    oil = float(row.get("oil_grams") or 0)
    if not is_fry_cook_mode(cook_mode):
        oil = 0.0

    if food_id:
        cat = get_catalog_product(conn, int(food_id))
        if not cat:
            return None
        out = {
            "foodId": int(food_id),
            "productId": None,
            "name": cat["name"],
            "fromCatalog": True,
            "grams": grams,
            "cookMode": cook_mode,
            "oilGrams": oil,
            "cookKind": cat.get("cookKind") or cat.get("cook_kind"),
            "kcalPer100g": float(cat.get("kcal_per_100g") or cat.get("kcalPer100g") or 0),
            "proteinPer100g": float(cat.get("protein_per_100g") or cat.get("proteinPer100g") or 0),
            "fatPer100g": float(cat.get("fat_per_100g") or cat.get("fatPer100g") or 0),
            "carbsPer100g": float(cat.get("carbs_per_100g") or cat.get("carbsPer100g") or 0),
            "fiberPer100g": float(cat.get("fiber_per_100g") or cat.get("fiberPer100g") or 0),
        }
    else:
        prod = conn.execute(
            """
            SELECT id, name, cook_kind, is_dish,
                   kcal_per_100g, protein_per_100g, fat_per_100g,
                   carbs_per_100g, fiber_per_100g
            FROM products
            WHERE id = %s
            """,
            (int(product_id),),
        ).fetchone()
        if not prod or prod.get("is_dish"):
            return None
        name = prod["name"]
        cook_kind = prod.get("cook_kind") or infer_cook_kind_from_name(name)
        out = {
            "foodId": None,
            "productId": int(prod["id"]),
            "name": name,
            "fromCatalog": False,
            "grams": grams,
            "cookMode": cook_mode,
            "oilGrams": oil,
            "cookKind": cook_kind,
            "kcalPer100g": float(prod.get("kcal_per_100g") or 0),
            "proteinPer100g": float(prod.get("protein_per_100g") or 0),
            "fatPer100g": float(prod.get("fat_per_100g") or 0),
            "carbsPer100g": float(prod.get("carbs_per_100g") or 0),
            "fiberPer100g": float(prod.get("fiber_per_100g") or 0),
        }

    out.update(
        bju_score_fields(
            kcal=out["kcalPer100g"],
            protein=out["proteinPer100g"],
            fat=out["fatPer100g"],
            carbs=out["carbsPer100g"],
            fiber=out["fiberPer100g"],
        )
    )
    return out


def get_dish(conn: psycopg.Connection, product_id: int) -> dict[str, Any]:
    product = _fetch_dish_product(conn, product_id)
    if not product or not product.get("isDish"):
        return {"ok": False, "error": "Блюдо не найдено"}

    rows = conn.execute(
        """
        SELECT food_id, ingredient_product_id, grams, cook_mode, oil_grams, sort_order
        FROM dish_items
        WHERE product_id = %s
        ORDER BY sort_order, id
        """,
        (product_id,),
    ).fetchall()
    items: list[dict[str, Any]] = []
    for row in rows:
        api_item = _ingredient_api_row(conn, dict(row))
        if api_item:
            items.append(api_item)

    return {
        "ok": True,
        "product": product,
        "items": items,
        "yieldGrams": product.get("dishYieldGrams"),
    }


def create_dish(conn: psycopg.Connection, body: dict[str, Any]) -> dict[str, Any]:
    resolved_body, err = _resolve_dish_body(conn, body)
    if err or not resolved_body:
        return {"ok": False, "error": err or "Не удалось собрать блюдо"}

    name = resolved_body["name"]
    norm = resolved_body["norm"]
    per100 = resolved_body["per100"]
    yield_grams = resolved_body["yield_grams"]
    totals = resolved_body["totals"]
    resolved = resolved_body["resolved"]

    taken = conn.execute(
        "SELECT id FROM products WHERE name_normalized = %s",
        (norm,),
    ).fetchone()
    if taken:
        return {"ok": False, "error": "Продукт с таким названием уже есть"}

    row = conn.execute(
        """
        INSERT INTO products (
            name, name_normalized,
            kcal_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g, fiber_per_100g,
            cook_kind, is_dish, dish_yield_grams
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, NULL, TRUE, %s)
        RETURNING id
        """,
        (
            name,
            norm,
            Decimal(str(per100["kcal"])),
            Decimal(str(per100["protein"])),
            Decimal(str(per100["fat"])),
            Decimal(str(per100["carbs"])),
            Decimal(str(per100["fiber"])),
            Decimal(str(yield_grams)),
        ),
    ).fetchone()
    pid = int(row["id"])
    _replace_dish_items(conn, pid, resolved)
    _save_dish_note(conn, pid, body)

    product = _fetch_dish_product(conn, pid)
    assert product is not None
    return _dish_ok_payload(product, totals, per100, yield_grams)


def update_dish(
    conn: psycopg.Connection, product_id: int, body: dict[str, Any]
) -> dict[str, Any]:
    existing = conn.execute(
        "SELECT id, is_dish FROM products WHERE id = %s",
        (product_id,),
    ).fetchone()
    if not existing or not existing.get("is_dish"):
        return {"ok": False, "error": "Блюдо не найдено"}

    resolved_body, err = _resolve_dish_body(conn, body)
    if err or not resolved_body:
        return {"ok": False, "error": err or "Не удалось собрать блюдо"}

    name = resolved_body["name"]
    norm = resolved_body["norm"]
    per100 = resolved_body["per100"]
    yield_grams = resolved_body["yield_grams"]
    totals = resolved_body["totals"]
    resolved = resolved_body["resolved"]

    for item in resolved:
        if item.get("productId") and int(item["productId"]) == int(product_id):
            return {"ok": False, "error": "Блюдо нельзя добавить как ингредиент"}

    taken = conn.execute(
        "SELECT id FROM products WHERE name_normalized = %s AND id <> %s",
        (norm, product_id),
    ).fetchone()
    if taken:
        return {"ok": False, "error": "Продукт с таким названием уже есть"}

    conn.execute(
        """
        UPDATE products SET
            name = %s,
            name_normalized = %s,
            kcal_per_100g = %s,
            protein_per_100g = %s,
            fat_per_100g = %s,
            carbs_per_100g = %s,
            fiber_per_100g = %s,
            dish_yield_grams = %s,
            cook_kind = NULL,
            is_dish = TRUE,
            updated_at = now()
        WHERE id = %s
        """,
        (
            name,
            norm,
            Decimal(str(per100["kcal"])),
            Decimal(str(per100["protein"])),
            Decimal(str(per100["fat"])),
            Decimal(str(per100["carbs"])),
            Decimal(str(per100["fiber"])),
            Decimal(str(yield_grams)),
            product_id,
        ),
    )
    _replace_dish_items(conn, product_id, resolved)
    _save_dish_note(conn, product_id, body)

    product = _fetch_dish_product(conn, product_id)
    assert product is not None
    return _dish_ok_payload(product, totals, per100, yield_grams)
