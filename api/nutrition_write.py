"""Запись: кастомные продукты и строки дневника (product XOR food)."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import psycopg

from catalog_read import get_catalog_product
from nutrition_common import (
    HIDDEN_FOOD_USER_ID,
    MEAL_IDS,
    PRODUCT_SELECT_COLS,
    account_grams_from_weighed,
    normalize_diary_cook_mode,
    normalize_product_name,
    parse_grams_input,
    parse_oil_grams,
    parse_positive_number,
    product_row_to_api,
    is_fry_cook_mode,
    remember_last_serving_food_grams,
    remember_last_serving_grams,
    resolve_cook_kind,
)


def create_product(conn: psycopg.Connection, body: dict[str, Any]) -> dict:
    name = str(body.get("name") or "").strip()
    if not name:
        return {"ok": False, "error": "Укажите название продукта"}

    fields = {
        "kcalPer100g": "kcal_per_100g",
        "proteinPer100g": "protein_per_100g",
        "fatPer100g": "fat_per_100g",
        "carbsPer100g": "carbs_per_100g",
        "fiberPer100g": "fiber_per_100g",
    }
    values: dict[str, float] = {}
    for api_key, col in fields.items():
        v = parse_positive_number(body.get(api_key))
        if v is None:
            return {"ok": False, "error": f"Некорректное значение: {api_key}"}
        values[col] = v

    cook_kind = resolve_cook_kind(body.get("cookKind", body.get("cook_kind")), name)
    norm = normalize_product_name(name)
    row = conn.execute(
        """
        INSERT INTO products (
            name, name_normalized,
            kcal_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g, fiber_per_100g,
            cook_kind
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (name_normalized) DO UPDATE SET
            name = EXCLUDED.name,
            kcal_per_100g = EXCLUDED.kcal_per_100g,
            protein_per_100g = EXCLUDED.protein_per_100g,
            fat_per_100g = EXCLUDED.fat_per_100g,
            carbs_per_100g = EXCLUDED.carbs_per_100g,
            fiber_per_100g = EXCLUDED.fiber_per_100g,
            cook_kind = EXCLUDED.cook_kind,
            updated_at = now()
        RETURNING """
        + PRODUCT_SELECT_COLS
        + """
        """,
        (
            name,
            norm,
            values["kcal_per_100g"],
            values["protein_per_100g"],
            values["fat_per_100g"],
            values["carbs_per_100g"],
            values["fiber_per_100g"],
            cook_kind,
        ),
    ).fetchone()
    return {"ok": True, "product": product_row_to_api(dict(row))}


def adopt_catalog_as_custom(conn: psycopg.Connection, body: dict[str, Any]) -> dict:
    """Изменить КБЖУ каталога → свой продукт + скрыть food (single-user)."""
    raw_food = body.get("foodId", body.get("food_id"))
    try:
        food_id = int(raw_food)
    except (TypeError, ValueError):
        return {"ok": False, "error": "Укажите foodId"}

    cat = get_catalog_product(conn, food_id)
    if not cat:
        return {"ok": False, "error": "Продукт каталога не найден"}

    name = str(body.get("name") or cat.get("name") or "").strip()
    if not name:
        return {"ok": False, "error": "Укажите название продукта"}

    fields = {
        "kcalPer100g": "kcal_per_100g",
        "proteinPer100g": "protein_per_100g",
        "fatPer100g": "fat_per_100g",
        "carbsPer100g": "carbs_per_100g",
        "fiberPer100g": "fiber_per_100g",
    }
    values: dict[str, float] = {}
    for api_key, col in fields.items():
        v = parse_positive_number(body.get(api_key))
        if v is None:
            return {"ok": False, "error": f"Некорректное значение: {api_key}"}
        values[col] = v

    cook_kind = resolve_cook_kind(body.get("cookKind", body.get("cook_kind")), name)
    if cook_kind is None:
        ck = cat.get("cook_kind")
        cook_kind = str(ck) if ck else None

    uid = HIDDEN_FOOD_USER_ID
    existing_hide = conn.execute(
        """
        SELECT product_id FROM user_hidden_food
        WHERE user_id = %s AND food_id = %s
        """,
        (uid, food_id),
    ).fetchone()
    if existing_hide:
        return update_product(
            conn,
            int(existing_hide["product_id"]),
            {
                "name": name,
                "kcalPer100g": values["kcal_per_100g"],
                "proteinPer100g": values["protein_per_100g"],
                "fatPer100g": values["fat_per_100g"],
                "carbsPer100g": values["carbs_per_100g"],
                "fiberPer100g": values["fiber_per_100g"],
                "cookKind": cook_kind,
            },
        )

    norm = normalize_product_name(name)
    by_name = conn.execute(
        """
        SELECT id, is_dish FROM products
        WHERE name_normalized = %s
        """,
        (norm,),
    ).fetchone()
    if by_name and by_name.get("is_dish"):
        return {
            "ok": False,
            "error": "У вас уже есть блюдо с таким названием — переименуйте",
        }

    if by_name:
        pid = int(by_name["id"])
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
                cook_kind = %s,
                updated_at = now()
            WHERE id = %s
            """,
            (
                name,
                norm,
                values["kcal_per_100g"],
                values["protein_per_100g"],
                values["fat_per_100g"],
                values["carbs_per_100g"],
                values["fiber_per_100g"],
                cook_kind,
                pid,
            ),
        )
    else:
        row = conn.execute(
            """
            INSERT INTO products (
                name, name_normalized,
                kcal_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g, fiber_per_100g,
                cook_kind
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                name,
                norm,
                values["kcal_per_100g"],
                values["protein_per_100g"],
                values["fat_per_100g"],
                values["carbs_per_100g"],
                values["fiber_per_100g"],
                cook_kind,
            ),
        ).fetchone()
        pid = int(row["id"])

    other_hide = conn.execute(
        """
        SELECT food_id FROM user_hidden_food
        WHERE user_id = %s AND product_id = %s
        """,
        (uid, pid),
    ).fetchone()
    if other_hide and int(other_hide["food_id"]) != food_id:
        return {
            "ok": False,
            "error": "Продукт с таким названием уже заменяет другой из каталога",
        }

    pref = conn.execute(
        """
        SELECT last_serving_grams FROM food_preferences
        WHERE food_id = %s AND last_serving_grams IS NOT NULL
        """,
        (food_id,),
    ).fetchone()
    if pref and pref["last_serving_grams"] is not None:
        remember_last_serving_grams(conn, pid, float(pref["last_serving_grams"]))

    meta = conn.execute(
        """
        SELECT is_favorite, note FROM nutrition_item_meta
        WHERE food_id = %s
        """,
        (food_id,),
    ).fetchone()
    if meta:
        conn.execute("DELETE FROM nutrition_item_meta WHERE food_id = %s", (food_id,))
        from item_meta import upsert_item_meta

        upsert_item_meta(
            conn,
            product_id=pid,
            favorite=bool(meta["is_favorite"]),
            note=meta.get("note"),
        )

    conn.execute(
        """
        INSERT INTO user_hidden_food (user_id, food_id, product_id)
        VALUES (%s, %s, %s)
        ON CONFLICT (user_id, food_id) DO UPDATE SET
            product_id = EXCLUDED.product_id
        """,
        (uid, food_id, pid),
    )

    full = conn.execute(
        f"""
        SELECT {PRODUCT_SELECT_COLS}
        FROM products
        WHERE id = %s
        """,
        (pid,),
    ).fetchone()
    product = product_row_to_api(dict(full))
    from item_meta import fetch_meta_fields

    product.update(fetch_meta_fields(conn, product_id=pid))
    return {"ok": True, "product": product}


def update_product(conn: psycopg.Connection, product_id: int, body: dict[str, Any]) -> dict:
    try:
        pid = int(product_id)
    except (TypeError, ValueError):
        return {"ok": False, "error": "Некорректный id продукта"}

    existing = conn.execute(
        "SELECT id, is_dish FROM products WHERE id = %s",
        (pid,),
    ).fetchone()
    if not existing:
        return {"ok": False, "error": "Продукт не найден"}

    name = str(body.get("name") or "").strip()
    if not name:
        return {"ok": False, "error": "Укажите название продукта"}

    fields = {
        "kcalPer100g": "kcal_per_100g",
        "proteinPer100g": "protein_per_100g",
        "fatPer100g": "fat_per_100g",
        "carbsPer100g": "carbs_per_100g",
        "fiberPer100g": "fiber_per_100g",
    }
    values: dict[str, float] = {}
    for api_key, col in fields.items():
        v = parse_positive_number(body.get(api_key))
        if v is None:
            return {"ok": False, "error": f"Некорректное значение: {api_key}"}
        values[col] = v

    is_dish = bool(existing.get("is_dish"))
    cook_kind = None if is_dish else resolve_cook_kind(body.get("cookKind", body.get("cook_kind")), name)
    norm = normalize_product_name(name)
    conflict = conn.execute(
        "SELECT id FROM products WHERE name_normalized = %s AND id <> %s",
        (norm, pid),
    ).fetchone()
    if conflict:
        return {"ok": False, "error": "Продукт с таким названием уже есть"}

    row = conn.execute(
        """
        UPDATE products SET
            name = %s,
            name_normalized = %s,
            kcal_per_100g = %s,
            protein_per_100g = %s,
            fat_per_100g = %s,
            carbs_per_100g = %s,
            fiber_per_100g = %s,
            cook_kind = %s,
            updated_at = now()
        WHERE id = %s
        RETURNING """
        + PRODUCT_SELECT_COLS
        + """
        """,
        (
            name,
            norm,
            values["kcal_per_100g"],
            values["protein_per_100g"],
            values["fat_per_100g"],
            values["carbs_per_100g"],
            values["fiber_per_100g"],
            cook_kind,
            pid,
        ),
    ).fetchone()
    return {"ok": True, "product": product_row_to_api(dict(row))}


def delete_product(conn: psycopg.Connection, product_id: int) -> dict:
    try:
        pid = int(product_id)
    except (TypeError, ValueError):
        return {"ok": False, "error": "Некорректный id продукта"}

    exists = conn.execute("SELECT id FROM products WHERE id = %s", (pid,)).fetchone()
    if not exists:
        return {"ok": False, "error": "Продукт не найден"}

    # Каскад: чистим лог, meta и ссылки RESTRICT dish_items, затем продукт.
    conn.execute("DELETE FROM dish_items WHERE ingredient_product_id = %s", (pid,))
    conn.execute("DELETE FROM nutrition_log WHERE product_id = %s", (pid,))
    conn.execute("DELETE FROM nutrition_item_meta WHERE product_id = %s", (pid,))
    row = conn.execute(
        "DELETE FROM products WHERE id = %s RETURNING id",
        (pid,),
    ).fetchone()
    if not row:
        return {"ok": False, "error": "Продукт не найден"}
    return {"ok": True, "productId": int(row["id"])}


def _parse_optional_id(raw: Any) -> int | None:
    if raw is None or raw == "":
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _resolve_log_grams(
    body: dict[str, Any], *, product_name: str | None = None
) -> tuple[float, float, str, float] | dict:
    """grams в теле = вес с весов. Возвращает (weighed, account, mode, oil)."""
    weighed = parse_grams_input(body.get("grams"))
    if weighed is None:
        return {"ok": False, "error": "Укажите граммы (> 0)"}
    cook_mode = normalize_diary_cook_mode(body.get("cookMode", body.get("cook_mode")))
    oil = parse_oil_grams(body.get("oilGrams", body.get("oil_grams")))
    if oil is None:
        return {"ok": False, "error": "Некорректные граммы масла"}
    if not is_fry_cook_mode(cook_mode):
        oil = 0.0
    account = account_grams_from_weighed(weighed, cook_mode, product_name=product_name)
    if account <= 0:
        return {"ok": False, "error": "Укажите граммы (> 0)"}
    return weighed, account, cook_mode, oil


def _log_item_name(
    conn: psycopg.Connection,
    product_id: int | None,
    food_id: int | None,
) -> str | None:
    if product_id is not None:
        row = conn.execute(
            "SELECT name FROM products WHERE id = %s",
            (product_id,),
        ).fetchone()
    elif food_id is not None:
        row = conn.execute("SELECT name FROM food WHERE id = %s", (food_id,)).fetchone()
    else:
        return None
    if not row or not row.get("name"):
        return None
    return str(row["name"])


def add_log_entry(conn: psycopg.Connection, body: dict[str, Any]) -> dict:
    day_iso = str(body.get("date") or "").strip()
    meal = str(body.get("mealGroup") or "").strip().lower()
    product_id = _parse_optional_id(body.get("productId") or body.get("product_id"))
    food_id = _parse_optional_id(
        body.get("foodId") or body.get("food_id") or body.get("catalogProductId")
    )

    if meal not in MEAL_IDS:
        return {"ok": False, "error": "Некорректный приём пищи"}

    if (product_id is None) == (food_id is None):
        return {"ok": False, "error": "Укажите productId или foodId"}

    product_name = _log_item_name(conn, product_id, food_id)
    resolved = _resolve_log_grams(body, product_name=product_name)
    if isinstance(resolved, dict):
        return resolved
    weighed, account, cook_mode, oil = resolved

    if product_id is not None:
        exists = conn.execute(
            "SELECT is_dish FROM products WHERE id = %s",
            (product_id,),
        ).fetchone()
        if not exists:
            return {"ok": False, "error": "Продукт не найден"}
        if exists.get("is_dish"):
            cook_mode = "plain"
            account = weighed
            oil = 0.0
        row = conn.execute(
            """
            INSERT INTO nutrition_log (
                log_date, meal_group, product_id, food_id,
                grams, weighed_grams, cook_mode, oil_grams
            )
            VALUES (%s::date, %s, %s, NULL, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                day_iso,
                meal,
                product_id,
                Decimal(str(account)),
                Decimal(str(weighed)),
                cook_mode,
                Decimal(str(oil)),
            ),
        ).fetchone()
        remember_last_serving_grams(conn, product_id, weighed)
        return {"ok": True, "entryId": int(row["id"]), "lastServingGrams": weighed}

    exists = conn.execute("SELECT 1 FROM food WHERE id = %s", (food_id,)).fetchone()
    if not exists:
        return {"ok": False, "error": "Продукт каталога не найден"}
    row = conn.execute(
        """
        INSERT INTO nutrition_log (
            log_date, meal_group, product_id, food_id,
            grams, weighed_grams, cook_mode, oil_grams
        )
        VALUES (%s::date, %s, NULL, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (
            day_iso,
            meal,
            food_id,
            Decimal(str(account)),
            Decimal(str(weighed)),
            cook_mode,
            Decimal(str(oil)),
        ),
    ).fetchone()
    remember_last_serving_food_grams(conn, food_id, weighed)
    return {"ok": True, "entryId": int(row["id"]), "lastServingGrams": weighed}


def update_log_entry(conn: psycopg.Connection, entry_id: int, body: dict[str, Any]) -> dict:
    try:
        eid = int(entry_id)
    except (TypeError, ValueError):
        return {"ok": False, "error": "Некорректный id записи"}

    grams_raw = body.get("grams")
    meal_raw = body.get("mealGroup", body.get("meal_group"))
    cook_raw = body.get("cookMode", body.get("cook_mode"))
    oil_raw = body.get("oilGrams", body.get("oil_grams"))
    has_grams = grams_raw is not None and str(grams_raw).strip() != ""
    has_meal = meal_raw is not None and str(meal_raw).strip() != ""
    has_cook = cook_raw is not None and str(cook_raw).strip() != ""
    has_oil = "oilGrams" in body or "oil_grams" in body
    if not has_grams and not has_meal and not has_cook and not has_oil:
        return {"ok": False, "error": "Укажите граммы или приём пищи"}

    existing = conn.execute(
        """
        SELECT nl.cook_mode, nl.weighed_grams, nl.grams, nl.oil_grams,
               COALESCE(p.is_dish, false) AS is_dish,
               COALESCE(p.name, f.name) AS item_name
        FROM nutrition_log nl
        LEFT JOIN products p ON p.id = nl.product_id
        LEFT JOIN food f ON f.id = nl.food_id
        WHERE nl.id = %s
        """,
        (eid,),
    ).fetchone()
    if not existing:
        return {"ok": False, "error": "Запись не найдена"}

    weighed = None
    account = None
    cook_mode = None
    oil = None
    if has_grams or has_cook or has_oil:
        prev_mode = normalize_diary_cook_mode(existing.get("cook_mode"))
        cook_mode = normalize_diary_cook_mode(cook_raw) if has_cook else prev_mode
        if existing.get("is_dish"):
            cook_mode = "plain"
        if has_grams:
            weighed = parse_grams_input(grams_raw)
            if weighed is None:
                return {"ok": False, "error": "Укажите граммы (> 0)"}
        else:
            prev_weighed = existing.get("weighed_grams")
            weighed = (
                float(prev_weighed)
                if prev_weighed is not None
                else float(existing["grams"])
            )
        if has_oil:
            oil = parse_oil_grams(oil_raw)
            if oil is None:
                return {"ok": False, "error": "Некорректные граммы масла"}
        else:
            oil = float(existing.get("oil_grams") or 0)
        if not is_fry_cook_mode(cook_mode):
            oil = 0.0
        if existing.get("is_dish"):
            oil = 0.0
            account = weighed
        else:
            account = account_grams_from_weighed(
                weighed, cook_mode, product_name=existing.get("item_name")
            )
        if account <= 0:
            return {"ok": False, "error": "Укажите граммы (> 0)"}

    meal = None
    if has_meal:
        meal = str(meal_raw).strip().lower()
        if meal not in MEAL_IDS or meal == "uncategorized":
            return {"ok": False, "error": "Некорректный приём пищи"}

    sets: list[str] = []
    params: list[Any] = []
    if weighed is not None and account is not None and cook_mode is not None and oil is not None:
        sets.append("grams = %s")
        params.append(Decimal(str(account)))
        sets.append("weighed_grams = %s")
        params.append(Decimal(str(weighed)))
        sets.append("cook_mode = %s")
        params.append(cook_mode)
        sets.append("oil_grams = %s")
        params.append(Decimal(str(oil)))
    if meal is not None:
        sets.append("meal_group = %s")
        params.append(meal)
    params.append(eid)

    row = conn.execute(
        f"""
        UPDATE nutrition_log SET {", ".join(sets)}
        WHERE id = %s
        RETURNING id, log_date, meal_group, product_id, food_id,
                  grams, weighed_grams, cook_mode, oil_grams
        """,
        params,
    ).fetchone()
    if not row:
        return {"ok": False, "error": "Запись не найдена"}

    display_grams = (
        float(row["weighed_grams"])
        if row["weighed_grams"] is not None
        else float(row["grams"])
    )
    entry: dict[str, Any] = {
        "id": int(row["id"]),
        "date": row["log_date"].isoformat(),
        "mealGroup": str(row["meal_group"]),
        "grams": display_grams,
    }
    if row["cook_mode"]:
        entry["cookMode"] = str(row["cook_mode"])
    oil_out = float(row["oil_grams"] or 0)
    if oil_out > 0 and is_fry_cook_mode(row["cook_mode"]):
        entry["oilGrams"] = round(oil_out, 1)
    if row["product_id"] is not None:
        pid = int(row["product_id"])
        entry["productId"] = pid
        if weighed is not None:
            remember_last_serving_grams(conn, pid, weighed)
    if row["food_id"] is not None:
        fid = int(row["food_id"])
        entry["foodId"] = fid
        if weighed is not None:
            remember_last_serving_food_grams(conn, fid, weighed)
    return {"ok": True, "entry": entry, "lastServingGrams": display_grams}


def delete_log_entry(conn: psycopg.Connection, entry_id: int) -> dict:
    try:
        eid = int(entry_id)
    except (TypeError, ValueError):
        return {"ok": False, "error": "Некорректный id записи"}
    row = conn.execute(
        "DELETE FROM nutrition_log WHERE id = %s RETURNING id",
        (eid,),
    ).fetchone()
    if not row:
        return {"ok": False, "error": "Запись не найдена"}
    return {"ok": True, "entryId": int(row["id"])}


def set_day_cheatmeal(conn: psycopg.Connection, day_iso: str, enabled: bool) -> dict:
    """Ручной читмил на день. Не меняет спорт / classify_sport_day."""
    if enabled:
        conn.execute(
            """
            INSERT INTO nutrition_day_flags (log_date, cheatmeal, updated_at)
            VALUES (%s, true, now())
            ON CONFLICT (log_date) DO UPDATE SET
                cheatmeal = true,
                updated_at = now()
            """,
            (day_iso,),
        )
    else:
        conn.execute(
            """
            DELETE FROM nutrition_day_flags
            WHERE log_date = %s
            """,
            (day_iso,),
        )
    from nutrition_read import build_nutrition_day_payload

    return build_nutrition_day_payload(conn, day_iso)
