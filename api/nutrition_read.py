"""Чтение питания за день: факт, таргеты, % для полосок (home — только сегодня)."""

from __future__ import annotations

import csv
import io
import sys
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import psycopg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "bot"))

from kbju import SportDayKind, classify_sport_day  # noqa: E402
from nutrition_common import (  # noqa: E402
    HIDDEN_FOOD_USER_ID,
    LOG_ITEM_JOINS,
    LOG_ITEM_MACRO_SELECT,
    MEAL_LABELS,
    MEAL_ORDER,
    PRODUCT_SELECT_COLS,
    apply_fry_oil_macros,
    is_fry_cook_mode,
    macro_for_grams,
    product_row_to_api,
)

_SPORT_KIND_LABEL = {
    SportDayKind.REST: "отдых",
    SportDayKind.WORKOUT: "воркаут",
    SportDayKind.CYCLING: "вело 60–90",
    SportDayKind.CYCLING_LONG: "вело 90+",
    SportDayKind.RUNNING: "бег",
}

# Ручной override; не в classify_sport_day / не требует нового enum на боте.
_CHEATMEAL_KIND = "cheatmeal"
_CHEATMEAL_LABEL = "читмил"


def _num(v: Any) -> float:
    if v is None:
        return 0.0
    if isinstance(v, Decimal):
        return float(v)
    return float(v)


def _sport_pending_from_day(conn: psycopg.Connection, day_iso: str) -> dict[int, Any]:
    day_row = conn.execute(
        "SELECT id FROM days WHERE day_date = %s",
        (day_iso,),
    ).fetchone()
    if not day_row:
        return {}
    rows = conn.execute(
        """
        SELECT field, value
        FROM sport_values
        WHERE day_id = %s
        """,
        (day_row["id"],),
    ).fetchall()
    pending: dict[int, Any] = {}
    for row in rows:
        try:
            pending[int(row["field"])] = row["value"]
        except (TypeError, ValueError):
            continue
    return pending


def _resolve_sport_day_kind(conn: psycopg.Connection, day_iso: str) -> SportDayKind:
    return classify_sport_day(_sport_pending_from_day(conn, day_iso))


def _is_cheatmeal_day(conn: psycopg.Connection, day_iso: str) -> bool:
    row = conn.execute(
        """
        SELECT cheatmeal
        FROM nutrition_day_flags
        WHERE log_date = %s
        """,
        (day_iso,),
    ).fetchone()
    return bool(row and row["cheatmeal"])


# Матрица КБЖУ (ноя 2026). Хардкод в коде — БД nutrition_targets не трогаем.
_NUTRITION_TARGETS_OVERRIDE: dict[str, dict[str, float]] = {
    "rest": {
        "calories_target": 2075,  # Σ БЖУ 4×150+9×75+4×200
        "calories_min": 2000,
        "calories_max": 2100,
        "protein_target": 150,
        "protein_min": 150,
        "protein_max": 150,
        "fat_target": 75,
        "fat_min": 75,
        "fat_max": 75,
        "carbs_target": 200,
        "carbs_min": 200,
        "carbs_max": 200,
        "fiber_target": 30,
    },
    "workout": {
        "calories_target": 2375,  # Σ БЖУ 4×155+9×75+4×270
        "calories_min": 2350,
        "calories_max": 2500,
        "protein_target": 155,
        "protein_min": 155,
        "protein_max": 155,
        "fat_target": 75,
        "fat_min": 75,
        "fat_max": 75,
        "carbs_target": 270,
        "carbs_min": 270,
        "carbs_max": 270,
        "fiber_target": 30,
    },
    "cycling": {
        "calories_target": 2465,  # Σ БЖУ 4×150+9×65+4×320
        "calories_min": 2450,
        "calories_max": 2600,
        "protein_target": 150,
        "protein_min": 150,
        "protein_max": 150,
        "fat_target": 65,
        "fat_min": 65,
        "fat_max": 65,
        "carbs_target": 320,
        "carbs_min": 320,
        "carbs_max": 320,
        "fiber_target": 30,
    },
    "cycling_long": {
        "calories_target": 2725,  # Σ БЖУ 4×155+9×65+4×380
        "calories_min": 2700,
        "calories_max": 2900,
        "protein_target": 155,
        "protein_min": 155,
        "protein_max": 155,
        "fat_target": 65,
        "fat_min": 65,
        "fat_max": 65,
        "carbs_target": 380,
        "carbs_min": 380,
        "carbs_max": 380,
        "fiber_target": 30,
    },
    "running": {
        "calories_target": 2125,
        "calories_min": 2050,
        "calories_max": 2200,
        "protein_target": 145,
        "protein_min": 145,
        "protein_max": 145,
        "fat_target": 65,
        "fat_min": 65,
        "fat_max": 65,
        "carbs_target": 240,
        "carbs_min": 240,
        "carbs_max": 240,
        "fiber_target": 30,
    },
    "cheatmeal": {
        "calories_target": 2565,  # Σ БЖУ 4×150+9×65+4×345
        "calories_min": 2600,
        "calories_max": 2700,
        "protein_target": 150,
        "protein_min": 150,
        "protein_max": 150,
        "fat_target": 65,
        "fat_min": 65,
        "fat_max": 65,
        "carbs_target": 345,
        "carbs_min": 345,
        "carbs_max": 345,
        "fiber_target": 30,
    },
}


def _load_targets(conn: psycopg.Connection, kind: SportDayKind | str) -> dict[str, Any] | None:
    kind_value = kind.value if isinstance(kind, SportDayKind) else str(kind)
    override = _NUTRITION_TARGETS_OVERRIDE.get(kind_value)
    if override:
        return {"sport_day_kind": kind_value, **override}
    # Fallback на БД только для неизвестных kind (не используется матрицей окт 2026).
    row = conn.execute(
        """
        SELECT sport_day_kind,
               calories_target, protein_target, fat_target, carbs_target, fiber_target,
               calories_min, calories_max,
               protein_min, protein_max,
               fat_min, fat_max,
               carbs_min, carbs_max
        FROM nutrition_targets
        WHERE sport_day_kind = %s
        """,
        (kind_value,),
    ).fetchone()
    return dict(row) if row else None


def _sum_day_totals(conn: psycopg.Connection, day_iso: str) -> dict[str, float]:
    rows = conn.execute(
        f"""
        SELECT nl.grams, nl.cook_mode, nl.oil_grams,
               {LOG_ITEM_MACRO_SELECT}
        FROM nutrition_log nl
        {LOG_ITEM_JOINS}
        WHERE nl.log_date = %s
        """,
        (day_iso,),
    ).fetchall()
    totals = {"kcal": 0.0, "protein": 0.0, "fat": 0.0, "carbs": 0.0, "fiber": 0.0}
    for row in rows:
        part = apply_fry_oil_macros(
            macro_for_grams(row, _num(row["grams"])),
            row.get("cook_mode"),
            _num(row.get("oil_grams")),
        )
        totals["kcal"] += part["kcal"]
        totals["protein"] += part["protein"]
        totals["fat"] += part["fat"]
        totals["carbs"] += part["carbs"]
        totals["fiber"] += part["fiber"]
    return totals


def _pct(fact: float, target: float) -> float:
    if target <= 0:
        return 0.0
    return round(100.0 * fact / target, 1)


def _bars_payload(totals: dict[str, float], targets: dict[str, Any]) -> list[dict[str, Any]]:
    mapping = (
        ("calories", "kcal", "calories_target", "kcal"),
        ("protein", "protein", "protein_target", "г"),
        ("carbs", "carbs", "carbs_target", "г"),
        ("fat", "fat", "fat_target", "г"),
    )
    bars = []
    for key, fact_key, target_key, unit in mapping:
        fact = totals[fact_key if fact_key != "kcal" else "kcal"]
        target = _num(targets[target_key])
        bars.append(
            {
                "key": key,
                "fact": round(fact, 1),
                "target": target,
                "unit": unit,
                "pct": _pct(fact, target),
            }
        )
    return bars


def _meal_entry_from_row(row: dict[str, Any]) -> dict[str, Any]:
    account_grams = _num(row["grams"])
    weighed_raw = row.get("weighed_grams")
    display_grams = _num(weighed_raw) if weighed_raw is not None else account_grams
    cook_mode = row.get("cook_mode")
    oil_grams = _num(row.get("oil_grams"))
    macros = apply_fry_oil_macros(
        macro_for_grams(row, account_grams), cook_mode, oil_grams
    )
    item_id = int(
        row.get("resolved_product_id")
        or row.get("resolved_food_id")
        or row["food_id"]
        or row["product_id"]
    )
    resolved_fid = row.get("resolved_food_id")
    per_100 = product_row_to_api(
        {
            "id": item_id,
            "name": row["name"],
            "kcal_per_100g": row["kcal_per_100g"],
            "protein_per_100g": row["protein_per_100g"],
            "fat_per_100g": row["fat_per_100g"],
            "carbs_per_100g": row["carbs_per_100g"],
            "fiber_per_100g": row["fiber_per_100g"],
            "cook_kind": row.get("cook_kind"),
            "is_dish": row.get("is_dish"),
            "from_catalog": resolved_fid is not None
            or (row.get("food_id") is not None and row.get("resolved_product_id") is None),
        }
    )
    entry: dict[str, Any] = {
        "id": int(row["id"]),
        "name": per_100["name"],
        "grams": round(display_grams, 1),
        "kcal": round(macros["kcal"], 1),
        "protein": round(macros["protein"], 1),
        "fat": round(macros["fat"], 1),
        "carbs": round(macros["carbs"], 1),
        "kcalPer100g": per_100["kcalPer100g"],
        "proteinPer100g": per_100["proteinPer100g"],
        "fatPer100g": per_100["fatPer100g"],
        "carbsPer100g": per_100["carbsPer100g"],
        "fiberPer100g": per_100["fiberPer100g"],
    }
    if cook_mode:
        entry["cookMode"] = str(cook_mode)
    if oil_grams > 0 and is_fry_cook_mode(cook_mode):
        entry["oilGrams"] = round(oil_grams, 1)
    resolved_pid = row.get("resolved_product_id")
    if resolved_pid is not None:
        entry["productId"] = int(resolved_pid)
    elif row.get("product_id") is not None:
        entry["productId"] = int(row["product_id"])
    if resolved_fid is not None:
        entry["foodId"] = int(resolved_fid)
        entry["fromCatalog"] = True
    elif row.get("food_id") is not None and resolved_pid is None:
        entry["foodId"] = int(row["food_id"])
        entry["fromCatalog"] = True
    if per_100.get("isDish"):
        entry["isDish"] = True
    if per_100.get("cookKind"):
        entry["cookKind"] = per_100["cookKind"]
    elif row.get("cook_kind") and not per_100.get("isDish"):
        entry["cookKind"] = row["cook_kind"]
    if "bjuScore" in per_100:
        entry["bjuScore"] = per_100["bjuScore"]
        entry["bjuTier"] = per_100["bjuTier"]
    return entry


def _load_meals(conn: psycopg.Connection, day_iso: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        f"""
        SELECT nl.id, nl.meal_group, nl.grams, nl.weighed_grams, nl.cook_mode, nl.oil_grams,
               nl.product_id, nl.food_id,
               {LOG_ITEM_MACRO_SELECT}
        FROM nutrition_log nl
        {LOG_ITEM_JOINS}
        WHERE nl.log_date = %s
        ORDER BY nl.id
        """,
        (day_iso,),
    ).fetchall()

    by_meal: dict[str, list[dict[str, Any]]] = {m: [] for m in MEAL_ORDER}
    extra: list[dict[str, Any]] = []

    for row in rows:
        meal = str(row["meal_group"] or "uncategorized")
        entry = _meal_entry_from_row(dict(row))
        if meal in by_meal:
            by_meal[meal].append(entry)
        else:
            extra.append(entry)

    meals: list[dict[str, Any]] = []
    for meal_id in MEAL_ORDER:
        items = by_meal[meal_id]
        kcal = sum(i["kcal"] for i in items)
        meals.append(
            {
                "id": meal_id,
                "label": MEAL_LABELS[meal_id],
                "kcal": round(kcal, 1),
                "entries": items,
            }
        )
    if extra:
        kcal = sum(i["kcal"] for i in extra)
        meals.append(
            {
                "id": "uncategorized",
                "label": MEAL_LABELS["uncategorized"],
                "kcal": round(kcal, 1),
                "entries": extra,
            }
        )
    return meals


def list_recent_logged_products(conn: psycopg.Connection, limit: int = 80) -> list[dict]:
    """Недавние кастомы + food: prefs (переживает delete лога), fallback — старый лог."""
    from catalog_read import catalog_row_to_api

    lim = max(1, min(int(limit), 200))
    uid = HIDDEN_FOOD_USER_ID
    rows = conn.execute(
        """
        WITH pref_custom AS (
            SELECT
                p.id,
                p.name,
                NULL::text AS source,
                NULL::text AS category_slug,
                p.kcal_per_100g,
                p.protein_per_100g,
                p.fat_per_100g,
                p.carbs_per_100g,
                p.fiber_per_100g,
                p.cook_kind,
                COALESCE(p.is_dish, false) AS is_dish,
                p.dish_yield_grams,
                NULL::integer AS food_id,
                p.last_serving_grams,
                false AS from_catalog,
                p.updated_at AS last_used
            FROM products p
            WHERE p.last_serving_grams IS NOT NULL
        ),
        pref_food AS (
            SELECT
                COALESCE(p_rep.id, f.id) AS id,
                COALESCE(p_rep.name, f.name) AS name,
                f.source,
                fc.slug AS category_slug,
                COALESCE(p_rep.kcal_per_100g, f.kcal_per_100g, 0) AS kcal_per_100g,
                COALESCE(p_rep.protein_per_100g, f.protein_per_100g, 0) AS protein_per_100g,
                COALESCE(p_rep.fat_per_100g, f.fat_per_100g, 0) AS fat_per_100g,
                COALESCE(p_rep.carbs_per_100g, f.carbs_per_100g, 0) AS carbs_per_100g,
                COALESCE(p_rep.fiber_per_100g, f.fiber_per_100g, 0) AS fiber_per_100g,
                COALESCE(p_rep.cook_kind, f.cook_kind, fc.cook_kind) AS cook_kind,
                COALESCE(p_rep.is_dish, false) AS is_dish,
                p_rep.dish_yield_grams,
                CASE WHEN uhf.product_id IS NOT NULL THEN NULL ELSE f.id END AS food_id,
                fp.last_serving_grams,
                (uhf.product_id IS NULL) AS from_catalog,
                fp.updated_at AS last_used
            FROM food_preferences fp
            JOIN food f ON f.id = fp.food_id
            LEFT JOIN food_categories fc ON fc.id = f.category_id
            LEFT JOIN user_hidden_food uhf
                ON uhf.food_id = f.id AND uhf.user_id = %s
            LEFT JOIN products p_rep ON p_rep.id = uhf.product_id
        ),
        log_recent AS (
            SELECT product_id, food_id, MAX(created_at) AS last_logged
            FROM nutrition_log
            GROUP BY product_id, food_id
        ),
        log_custom AS (
            SELECT
                p.id,
                p.name,
                NULL::text AS source,
                NULL::text AS category_slug,
                p.kcal_per_100g,
                p.protein_per_100g,
                p.fat_per_100g,
                p.carbs_per_100g,
                p.fiber_per_100g,
                p.cook_kind,
                COALESCE(p.is_dish, false) AS is_dish,
                p.dish_yield_grams,
                NULL::integer AS food_id,
                p.last_serving_grams,
                false AS from_catalog,
                r.last_logged AS last_used
            FROM log_recent r
            JOIN products p ON p.id = r.product_id
            WHERE r.product_id IS NOT NULL
              AND p.last_serving_grams IS NULL
        ),
        log_food AS (
            SELECT
                COALESCE(p_rep.id, f.id) AS id,
                COALESCE(p_rep.name, f.name) AS name,
                f.source,
                fc.slug AS category_slug,
                COALESCE(p_rep.kcal_per_100g, f.kcal_per_100g, 0) AS kcal_per_100g,
                COALESCE(p_rep.protein_per_100g, f.protein_per_100g, 0) AS protein_per_100g,
                COALESCE(p_rep.fat_per_100g, f.fat_per_100g, 0) AS fat_per_100g,
                COALESCE(p_rep.carbs_per_100g, f.carbs_per_100g, 0) AS carbs_per_100g,
                COALESCE(p_rep.fiber_per_100g, f.fiber_per_100g, 0) AS fiber_per_100g,
                COALESCE(p_rep.cook_kind, f.cook_kind, fc.cook_kind) AS cook_kind,
                COALESCE(p_rep.is_dish, false) AS is_dish,
                p_rep.dish_yield_grams,
                CASE WHEN uhf.product_id IS NOT NULL THEN NULL ELSE f.id END AS food_id,
                fp.last_serving_grams,
                (uhf.product_id IS NULL) AS from_catalog,
                r.last_logged AS last_used
            FROM log_recent r
            JOIN food f ON f.id = r.food_id
            LEFT JOIN food_categories fc ON fc.id = f.category_id
            LEFT JOIN user_hidden_food uhf
                ON uhf.food_id = f.id AND uhf.user_id = %s
            LEFT JOIN products p_rep ON p_rep.id = uhf.product_id
            LEFT JOIN food_preferences fp ON fp.food_id = f.id
            WHERE r.food_id IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM food_preferences fp2 WHERE fp2.food_id = f.id
              )
        )
        SELECT * FROM (
            SELECT * FROM pref_custom
            UNION ALL
            SELECT * FROM pref_food
            UNION ALL
            SELECT * FROM log_custom
            UNION ALL
            SELECT * FROM log_food
        ) u
        ORDER BY last_used DESC
        LIMIT %s
        """,
        (uid, uid, lim),
    ).fetchall()
    out: list[dict] = []
    for r in rows:
        d = dict(r)
        if d.get("from_catalog"):
            item = catalog_row_to_api(
                {
                    "id": d["id"],
                    "name": d["name"],
                    "source": d.get("source") or "",
                    "manufacturer_name": None,
                    "kcal_per_100g": d["kcal_per_100g"],
                    "protein_per_100g": d["protein_per_100g"],
                    "fat_per_100g": d["fat_per_100g"],
                    "carbs_per_100g": d["carbs_per_100g"],
                    "fiber_per_100g": d["fiber_per_100g"],
                    "cook_kind": d.get("cook_kind"),
                    "category_slug": d.get("category_slug"),
                }
            )
            if d.get("food_id") is not None:
                item["foodId"] = int(d["food_id"])
            if d.get("last_serving_grams") is not None:
                item["lastServingGrams"] = float(d["last_serving_grams"])
            from item_meta import fetch_meta_fields

            item.update(fetch_meta_fields(conn, food_id=int(d["food_id"] or d["id"])))
            out.append(item)
        else:
            item = product_row_to_api(d)
            from item_meta import fetch_meta_fields

            item.update(fetch_meta_fields(conn, product_id=int(d["id"])))
            out.append(item)
    return out


def list_my_products(
    conn: psycopg.Connection,
    query: str = "",
    limit: int = 200,
    *,
    mine_only: bool = False,
    dishes_only: bool = False,
) -> list[dict]:
    from search_text import expand_search_token_groups

    lim = max(1, min(int(limit), 200))
    q = (query or "").strip()
    if dishes_only:
        kind_sql = "AND COALESCE(is_dish, false)"
    elif mine_only:
        kind_sql = "AND NOT COALESCE(is_dish, false)"
    else:
        kind_sql = ""
    if q:
        _primary, token_groups = expand_search_token_groups(q)
        where: list[str] = []
        params: list[Any] = []
        if token_groups:
            for terms in token_groups:
                where.append(
                    "("
                    + " OR ".join(["name_normalized LIKE %s OR name ILIKE %s"] * len(terms))
                    + ")"
                )
                for v in terms:
                    like = f"%{v}%"
                    params.extend((like.lower(), like))
        else:
            like = f"%{q.lower()}%"
            where.append("name_normalized LIKE %s OR name ILIKE %s")
            params.extend((like, like))
        params.append(lim)
        mine_order = (
            "COALESCE(CASE WHEN last_serving_grams IS NOT NULL THEN updated_at END, "
            "'-infinity'::timestamptz) DESC, updated_at DESC, name"
            if mine_only
            else "name"
        )
        rows = conn.execute(
            """
            SELECT """
            + PRODUCT_SELECT_COLS
            + """
            FROM products
            WHERE """
            + " AND ".join(where)
            + """
              """
            + kind_sql
            + f"""
            ORDER BY {mine_order}
            LIMIT %s
            """,
            params,
        ).fetchall()
    else:
        mine_order = (
            "COALESCE(CASE WHEN last_serving_grams IS NOT NULL THEN updated_at END, "
            "'-infinity'::timestamptz) DESC, updated_at DESC, name"
            if mine_only
            else "updated_at DESC, name"
        )
        rows = conn.execute(
            """
            SELECT """
            + PRODUCT_SELECT_COLS
            + """
            FROM products
            WHERE TRUE
              """
            + kind_sql
            + f"""
            ORDER BY {mine_order}
            LIMIT %s
            """,
            (lim,),
        ).fetchall()
    from item_meta import fetch_meta_fields

    out = []
    for r in rows:
        item = product_row_to_api(dict(r))
        item.update(fetch_meta_fields(conn, product_id=int(r["id"])))
        out.append(item)
    return out


def list_products(
    conn: psycopg.Connection,
    query: str = "",
    limit: int = 80,
    scope: str = "recent",
) -> list[dict]:
    """scope=mine — свои без блюд; scope=dishes — только is_dish; recent — смесь."""
    scope_norm = (scope or "recent").strip().lower()
    mine_only = scope_norm == "mine"
    dishes_only = scope_norm == "dishes"
    if mine_only or dishes_only:
        return list_my_products(
            conn, query, limit, mine_only=mine_only, dishes_only=dishes_only
        )

    q = query.strip().lower()
    lim = max(1, min(int(limit), 200))
    if q:
        return list_my_products(conn, query, lim)

    recent = list_recent_logged_products(conn, lim)
    if recent:
        return recent
    return list_my_products(conn, "", lim)


def get_product_by_id(conn: psycopg.Connection, product_id: int) -> dict | None:
    row = conn.execute(
        """
        SELECT """
        + PRODUCT_SELECT_COLS
        + """
        FROM products WHERE id = %s
        """,
        (product_id,),
    ).fetchone()
    if not row:
        return None
    item = product_row_to_api(dict(row))
    from item_meta import fetch_meta_fields

    item.update(fetch_meta_fields(conn, product_id=product_id))
    return item


def build_nutrition_day_payload(conn: psycopg.Connection, day_iso: str) -> dict:
    sport_kind = _resolve_sport_day_kind(conn, day_iso)
    cheatmeal = _is_cheatmeal_day(conn, day_iso)
    # Читмил перекрывает таргеты; спорт из «Заполнить» остаётся в sportDayKind.
    target_kind: SportDayKind | str = _CHEATMEAL_KIND if cheatmeal else sport_kind
    targets_row = _load_targets(conn, target_kind)
    if not targets_row:
        kind_name = target_kind if isinstance(target_kind, str) else target_kind.value
        return {
            "ok": False,
            "error": f"Нет таргетов для {kind_name}",
            "date": day_iso,
        }

    totals = _sum_day_totals(conn, day_iso)
    targets = {
        "calories": _num(targets_row["calories_target"]),
        "protein": _num(targets_row["protein_target"]),
        "fat": _num(targets_row["fat_target"]),
        "carbs": _num(targets_row["carbs_target"]),
        "fiber": _num(targets_row["fiber_target"]),
        "ranges": {
            "calories": [_num(targets_row["calories_min"]), _num(targets_row["calories_max"])],
            "protein": [_num(targets_row["protein_min"]), _num(targets_row["protein_max"])],
            "fat": [_num(targets_row["fat_min"]), _num(targets_row["fat_max"])],
            "carbs": [_num(targets_row["carbs_min"]), _num(targets_row["carbs_max"])],
        },
    }

    return {
        "ok": True,
        "date": day_iso,
        "sportDayKind": sport_kind.value,
        "sportDayLabel": _CHEATMEAL_LABEL if cheatmeal else _SPORT_KIND_LABEL.get(sport_kind, sport_kind.value),
        "cheatMeal": cheatmeal,
        "totals": {
            "calories": round(totals["kcal"], 1),
            "protein": round(totals["protein"], 1),
            "fat": round(totals["fat"], 1),
            "carbs": round(totals["carbs"], 1),
            "fiber": round(totals["fiber"], 1),
        },
        "targets": targets,
        "bars": _bars_payload(totals, targets_row),
        "entryCount": conn.execute(
            "SELECT COUNT(*)::int AS n FROM nutrition_log WHERE log_date = %s",
            (day_iso,),
        ).fetchone()["n"],
        "meals": _load_meals(conn, day_iso),
    }


NUTRITION_EXPORT_PERIODS = frozenset({"7d", "30d", "all"})

NUTRITION_CSV_HEADER = (
    "День",
    "Тип активности",
    "Ккал",
    "Белок (г)",
    "Углеводы (г)",
    "Жиры (г)",
    "Клетчатка (г)",
)


def _export_activity_label(conn: psycopg.Connection, day_iso: str) -> str:
    """Как sportDayLabel в UI: читмил перекрывает спорт."""
    if _is_cheatmeal_day(conn, day_iso):
        return _CHEATMEAL_LABEL
    sport_kind = _resolve_sport_day_kind(conn, day_iso)
    return _SPORT_KIND_LABEL.get(sport_kind, sport_kind.value)


def _period_bounds(period: str, today: date | None = None) -> tuple[date, date]:
    ref = today or date.today()
    if period == "7d":
        return ref - timedelta(days=6), ref
    if period == "30d":
        return ref - timedelta(days=29), ref
    if period == "all":
        return ref - timedelta(days=364), ref
    raise ValueError(f"Неизвестный период: {period}")


def _format_export_day(d: date) -> str:
    return d.strftime("%d.%m.%Y")


def export_csv_filename(period: str) -> str:
    file_period = "365d" if period == "all" else period
    return f"kbju-{file_period}.csv"


def list_daily_nutrition_totals(
    conn: psycopg.Connection,
    period: str,
    today: date | None = None,
) -> list[dict[str, Any]]:
    start, end = _period_bounds(period, today)
    macro_sql = f"""
            SELECT nl.log_date,
                   SUM(
                       nl.grams * COALESCE(p.kcal_per_100g, p_rep.kcal_per_100g, f.kcal_per_100g, 0) / 100.0
                       + CASE WHEN nl.cook_mode IN ('fry_meat', 'fry_veg')
                              THEN COALESCE(nl.oil_grams, 0) * 9.0 ELSE 0 END
                   ) AS kcal,
                   SUM(nl.grams * COALESCE(p.protein_per_100g, p_rep.protein_per_100g, f.protein_per_100g, 0) / 100.0) AS protein,
                   SUM(nl.grams * COALESCE(p.carbs_per_100g, p_rep.carbs_per_100g, f.carbs_per_100g, 0) / 100.0) AS carbs,
                   SUM(
                       nl.grams * COALESCE(p.fat_per_100g, p_rep.fat_per_100g, f.fat_per_100g, 0) / 100.0
                       + CASE WHEN nl.cook_mode IN ('fry_meat', 'fry_veg')
                              THEN COALESCE(nl.oil_grams, 0) ELSE 0 END
                   ) AS fat,
                   SUM(nl.grams * COALESCE(p.fiber_per_100g, p_rep.fiber_per_100g, f.fiber_per_100g, 0) / 100.0) AS fiber
            FROM nutrition_log nl
            LEFT JOIN products p ON p.id = nl.product_id
            LEFT JOIN food f ON f.id = nl.food_id
            LEFT JOIN user_hidden_food uhf
                ON uhf.food_id = nl.food_id AND uhf.user_id = {HIDDEN_FOOD_USER_ID}
            LEFT JOIN products p_rep ON p_rep.id = uhf.product_id
            WHERE nl.log_date >= %s AND nl.log_date <= %s
            GROUP BY nl.log_date
            ORDER BY nl.log_date
    """
    rows = conn.execute(macro_sql, (start, end)).fetchall()

    by_day: dict[date, dict[str, Any]] = {}
    for row in rows:
        d = row["log_date"]
        if not isinstance(d, date):
            d = date.fromisoformat(str(d))
        by_day[d] = row

    out: list[dict[str, Any]] = []
    d = start
    while d <= end:
        day_iso = d.isoformat()
        row = by_day.get(d)
        out.append(
            {
                "day": _format_export_day(d),
                "activityLabel": _export_activity_label(conn, day_iso),
                "kcal": round(_num(row["kcal"]), 1) if row else 0.0,
                "protein": round(_num(row["protein"]), 1) if row else 0.0,
                "carbs": round(_num(row["carbs"]), 1) if row else 0.0,
                "fat": round(_num(row["fat"]), 1) if row else 0.0,
                "fiber": round(_num(row["fiber"]), 1) if row else 0.0,
            }
        )
        d += timedelta(days=1)
    return out


def build_nutrition_export_csv(conn: psycopg.Connection, period: str) -> str:
    rows = list_daily_nutrition_totals(conn, period)
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(NUTRITION_CSV_HEADER)
    for row in rows:
        writer.writerow(
            [
                row["day"],
                row["activityLabel"],
                row["kcal"],
                row["protein"],
                row["carbs"],
                row["fat"],
                row["fiber"],
            ]
        )
    return buf.getvalue()
