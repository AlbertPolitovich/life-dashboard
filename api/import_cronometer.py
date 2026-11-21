#!/usr/bin/env python3
"""
Импорт Cronometer servings.csv → products (КБЖУ на 100 г) + nutrition_log.

Правила продуктов (по умолчанию):
- не обновлять уже имеющиеся (--skip-existing, по умолчанию вкл. для --products-only)
- не импортировать рецепты (full recipe, база добавок…)
- для каталога продуктов — только строки с граммами в Amount (не «1.00 each»)

Пример:
  python import_cronometer.py servings.csv --rollback
  python import_cronometer.py servings.csv --log-only --since 2026-06-11 --until 2026-06-17 --replace-log-range
  python import_cronometer.py servings.csv --products-only --allow-update   # старое поведение
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
import unicodedata
from datetime import datetime
from decimal import Decimal
from pathlib import Path

import psycopg
from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://life:life@localhost:5432/life_dashboard",
).strip()

GRAMS_RE = re.compile(
    r"([\d.,]+)\s*(?:g|гр?\.?)\b",
    re.IGNORECASE,
)
AMOUNT_NUM_RE = re.compile(r"([\d.,]+)")
MOJIBAKE_MARKERS = ("Ð", "Ñ", "Ã", "â€™", "â€")
MACRO_KEYS = (
    "kcal_per_100g",
    "protein_per_100g",
    "fat_per_100g",
    "carbs_per_100g",
    "fiber_per_100g",
)

MEAL_MAP = {
    "breakfast": "breakfast",
    "lunch": "lunch",
    "dinner": "dinner",
    "snacks": "snacks",
    "uncategorized": "uncategorized",
}

# Откат последнего импорта с усреднением (июнь 2026)
DEFAULT_ROLLBACK_AFTER = "2026-06-17 12:40:00+00"


def normalize_name(name: str) -> str:
    return unicodedata.normalize("NFC", name.strip().lower())


def fix_text_encoding(text: str) -> str:
    s = unicodedata.normalize("NFC", (text or "").strip())
    if not s or not any(m in s for m in MOJIBAKE_MARKERS):
        return s
    for enc in ("cp1251", "latin-1"):
        try:
            fixed = s.encode(enc).decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
        if sum(1 for c in fixed if "\u0400" <= c <= "\u04FF") > 0:
            return unicodedata.normalize("NFC", fixed)
    return s


def is_recipe_row(row: dict[str, str]) -> bool:
    amount = (row.get("Amount") or "").lower()
    name = fix_text_encoding((row.get("Food Name") or "")).lower()
    if "full recipe" in amount:
        return True
    if "база добавок" in name:
        return True
    if name.endswith(" recipe") or " recipe)" in name:
        return True
    return False


def _parse_amount_number(raw: str) -> float | None:
    s = (raw or "").strip().replace(",", ".")
    if not s:
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return v if v > 0 else None


def parse_grams(amount: str) -> float | None:
    m = GRAMS_RE.search(amount or "")
    if m:
        return _parse_amount_number(m.group(1))
    return None


def parse_serving_size(amount: str) -> float | None:
    g = parse_grams(amount)
    if g is not None:
        return g
    m = AMOUNT_NUM_RE.search(amount or "")
    if m:
        return _parse_amount_number(m.group(1))
    return None


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "utf-8", "cp1251"):
        try:
            text = raw.decode(enc)
            reader = csv.DictReader(text.splitlines())
            rows = list(reader)
            if rows and enc != "cp1251":
                sample = " ".join(r.get("Food Name", "") for r in rows[:12])
                cyr = sum(1 for c in sample if "\u0400" <= c <= "\u04FF")
                if cyr == 0 and "Ð" in sample:
                    continue
            print(f"CSV encoding: {enc}, rows: {len(rows)}")
            return rows
        except UnicodeDecodeError:
            continue
    raise RuntimeError(f"Не удалось прочитать {path} (utf-8 / cp1251)")


def per_100_from_row(row: dict[str, str], grams: float) -> dict[str, float] | None:
    if grams <= 0:
        return None
    try:
        kcal = float(row.get("Energy (kcal)") or 0)
        protein = float(row.get("Protein (g)") or 0)
        fat = float(row.get("Fat (g)") or 0)
        carbs = float(row.get("Carbs (g)") or 0)
        fiber = float(row.get("Fiber (g)") or 0)
    except ValueError:
        return None
    scale = 100.0 / grams
    return {k: v * scale for k, v in zip(MACRO_KEYS, (kcal, protein, fat, carbs, fiber))}


def build_best_per_100_legacy(rows: list[dict[str, str]]) -> dict[str, tuple[dict[str, float], str]]:
    """Как в импорте до фикса (для отката merge 50/50)."""
    best: dict[str, tuple[dict[str, float], bool, str]] = {}
    for row in rows:
        name = fix_text_encoding((row.get("Food Name") or "").strip())
        if not name:
            continue
        amount = row.get("Amount") or ""
        serving = parse_serving_size(amount)
        if serving is None:
            continue
        per_100 = per_100_from_row(row, serving)
        if not per_100:
            continue
        norm = normalize_name(name)
        has_grams = parse_grams(amount) is not None
        prev = best.get(norm)
        if prev is None or (has_grams and not prev[1]):
            best[norm] = (per_100, has_grams, name)
    return {k: (v[0], v[2]) for k, v in best.items()}


def sane_per_100(d: dict[str, float]) -> bool:
    if any(d[k] < 0 for k in MACRO_KEYS):
        return False
    if d["kcal_per_100g"] > 2500:
        return False
    if d["protein_per_100g"] > 120:
        return False
    return True


def build_best_per_100(
    rows: list[dict[str, str]],
    *,
    grams_only: bool,
    skip_recipes: bool,
) -> dict[str, tuple[dict[str, float], str]]:
    best: dict[str, tuple[dict[str, float], str]] = {}
    for row in rows:
        if skip_recipes and is_recipe_row(row):
            continue
        name = fix_text_encoding((row.get("Food Name") or "").strip())
        if not name:
            continue
        amount = row.get("Amount") or ""
        grams = parse_grams(amount)
        if grams_only and grams is None:
            continue
        serving = grams if grams is not None else parse_serving_size(amount)
        if serving is None:
            continue
        per_100 = per_100_from_row(row, serving)
        if not per_100:
            continue
        norm = normalize_name(name)
        has_grams = grams is not None
        prev = best.get(norm)
        if prev is None or (has_grams and grams_only):
            best[norm] = (per_100, name)
        elif not grams_only:
            # legacy: предпочитаем строки с граммами
            pass
    return best


def upsert_product(
    conn: psycopg.Connection,
    name: str,
    per_100: dict[str, float],
    cache: dict[str, int],
    *,
    skip_existing: bool,
    allow_update: bool,
) -> int | None:
    norm = normalize_name(name)
    if norm in cache:
        return cache[norm]

    row = conn.execute(
        "SELECT id FROM products WHERE name_normalized = %s",
        (norm,),
    ).fetchone()

    if row is not None:
        pid = int(row["id"])
        cache[norm] = pid
        if skip_existing or not allow_update:
            return pid
        conn.execute(
            """
            UPDATE products SET
                name = %s,
                kcal_per_100g = %s,
                protein_per_100g = %s,
                fat_per_100g = %s,
                carbs_per_100g = %s,
                fiber_per_100g = %s,
                updated_at = now()
            WHERE id = %s
            """,
            (
                name.strip(),
                per_100["kcal_per_100g"],
                per_100["protein_per_100g"],
                per_100["fat_per_100g"],
                per_100["carbs_per_100g"],
                per_100["fiber_per_100g"],
                pid,
            ),
        )
        return pid

    inserted = conn.execute(
        """
        INSERT INTO products (
            name, name_normalized,
            kcal_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g, fiber_per_100g
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (
            name.strip(),
            norm,
            per_100["kcal_per_100g"],
            per_100["protein_per_100g"],
            per_100["fat_per_100g"],
            per_100["carbs_per_100g"],
            per_100["fiber_per_100g"],
        ),
    ).fetchone()
    pid = int(inserted["id"])
    cache[norm] = pid
    return pid


def load_product_id_cache(conn: psycopg.Connection) -> dict[str, int]:
    rows = conn.execute("SELECT id, name_normalized FROM products").fetchall()
    return {str(r["name_normalized"]): int(r["id"]) for r in rows}


def rollback_import(
    conn: psycopg.Connection,
    csv_path: Path,
    import_after: str,
    *,
    dry_run: bool,
) -> tuple[int, int]:
    """Откат импорта с усреднением 50/50: old = 2*current - csv."""
    rows = read_csv_rows(csv_path)
    best = build_best_per_100_legacy(rows)

    touched = conn.execute(
        """
        SELECT id, name, name_normalized, created_at, updated_at,
               kcal_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g, fiber_per_100g
        FROM products
        WHERE updated_at >= %s::timestamptz
        ORDER BY id
        """,
        (import_after,),
    ).fetchall()

    rollback_ts = datetime.fromisoformat(import_after.replace("Z", "+00:00"))

    restored = 0
    deleted = 0
    for p in touched:
        norm = str(p["name_normalized"])
        created = p["created_at"]
        is_new = created >= rollback_ts

        if is_new or (p["updated_at"] - created).total_seconds() < 1:
            if not dry_run:
                conn.execute("DELETE FROM products WHERE id = %s", (p["id"],))
            deleted += 1
            print(f"  DELETE {p['id']} {p['name']}")
            continue

        if norm not in best:
            print(f"  SKIP (нет в CSV) {p['id']} {p['name']}")
            continue

        csv_per = best[norm][0]
        restored_vals = {k: 2.0 * float(p[k]) - csv_per[k] for k in MACRO_KEYS}
        if not sane_per_100(restored_vals):
            print(f"  SKIP (bad reverse) {p['id']} {p['name']}")
            continue
        if not dry_run:
            conn.execute(
                """
                UPDATE products SET
                    kcal_per_100g = %s,
                    protein_per_100g = %s,
                    fat_per_100g = %s,
                    carbs_per_100g = %s,
                    fiber_per_100g = %s,
                    updated_at = GREATEST(created_at, %s::timestamptz - interval '1 second')
                WHERE id = %s
                """,
                (
                    restored_vals["kcal_per_100g"],
                    restored_vals["protein_per_100g"],
                    restored_vals["fat_per_100g"],
                    restored_vals["carbs_per_100g"],
                    restored_vals["fiber_per_100g"],
                    import_after,
                    p["id"],
                ),
            )
        restored += 1

    return restored, deleted


def read_summary_date_range(path: Path) -> tuple[str, str]:
    """Мин/макс даты из Cronometer dailysummary.csv (колонка Date)."""
    rows = read_csv_rows(path)
    dates = sorted(
        {
            (r.get("Date") or r.get("Day") or "").strip()
            for r in rows
            if (r.get("Date") or r.get("Day") or "").strip()
        }
    )
    if not dates:
        raise RuntimeError(f"Нет дат в {path}")
    return dates[0], dates[-1]


def in_date_range(day: str, since: str | None, until: str | None) -> bool:
    if since and day < since:
        return False
    if until and day > until:
        return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Import Cronometer servings.csv")
    parser.add_argument("csv_path", type=Path)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--rollback", action="store_true", help="Откат импорта с усреднением")
    parser.add_argument(
        "--rollback-after",
        default=DEFAULT_ROLLBACK_AFTER,
        help="timestamptz: что считать «плохим» импортом",
    )
    parser.add_argument("--clear-log", action="store_true")
    parser.add_argument("--products-only", action="store_true")
    parser.add_argument("--log-only", action="store_true", help="Только nutrition_log")
    parser.add_argument("--since", help="Лог: с даты YYYY-MM-DD")
    parser.add_argument("--until", help="Лог: по дату YYYY-MM-DD")
    parser.add_argument(
        "--replace-log-range",
        action="store_true",
        help="Удалить nutrition_log в диапазоне --since/--until перед импортом",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        default=None,
        help="Не обновлять существующие продукты (default для --products-only)",
    )
    parser.add_argument(
        "--allow-update",
        action="store_true",
        help="Разрешить перезапись существующих продуктов",
    )
    parser.add_argument(
        "--dates-from",
        type=Path,
        help="dailysummary.csv → --since/--until по колонке Date",
    )
    parser.add_argument(
        "--include-recipes",
        action="store_true",
        help="Не фильтровать рецепты (по умолчанию рецепты пропускаются)",
    )
    args = parser.parse_args()

    if args.dates_from:
        since, until = read_summary_date_range(args.dates_from)
        args.since = args.since or since
        args.until = args.until or until
        print(f"Dates from {args.dates_from.name}: {args.since} … {args.until}")

    if args.rollback:
        with psycopg.connect(DATABASE_URL, row_factory=psycopg.rows.dict_row) as conn:
            print(f"Rollback after {args.rollback_after} …")
            restored, deleted = rollback_import(
                conn, args.csv_path, args.rollback_after, dry_run=args.dry_run
            )
            if not args.dry_run:
                conn.commit()
        print(f"Rollback: restored={restored}, deleted={deleted}")
        return 0

    skip_existing = args.skip_existing
    if skip_existing is None:
        skip_existing = not args.allow_update

    rows = read_csv_rows(args.csv_path)
    if args.limit > 0:
        rows = rows[: args.limit]

    skip_recipes = not args.include_recipes
    skipped = 0
    products_inserted = 0
    products_skipped = 0
    log_imported = 0
    log_skipped = 0
    product_cache: dict[str, int] = {}

    with psycopg.connect(DATABASE_URL, row_factory=psycopg.rows.dict_row) as conn:
        product_cache = load_product_id_cache(conn)

        if args.clear_log and not args.dry_run:
            conn.execute("DELETE FROM nutrition_log")
            print("Cleared nutrition_log")

        if args.replace_log_range and args.since and args.until and not args.dry_run:
            conn.execute(
                "DELETE FROM nutrition_log WHERE log_date BETWEEN %s::date AND %s::date",
                (args.since, args.until),
            )
            print(f"Cleared nutrition_log {args.since} … {args.until}")

        if not args.log_only:
            best = build_best_per_100(
                rows, grams_only=True, skip_recipes=skip_recipes
            )
            for norm, (per_100, display_name) in best.items():
                if norm in product_cache and skip_existing:
                    products_skipped += 1
                    continue
                if args.dry_run:
                    products_inserted += 1
                    continue
                before = norm in product_cache
                pid = upsert_product(
                    conn,
                    display_name,
                    per_100,
                    product_cache,
                    skip_existing=skip_existing,
                    allow_update=args.allow_update,
                )
                if pid and not before:
                    products_inserted += 1
                elif before:
                    products_skipped += 1

        if args.products_only:
            if not args.dry_run:
                conn.commit()
            print(
                f"Products inserted: {products_inserted}, skipped existing: {products_skipped}"
            )
            return 0

        for row in rows:
            if skip_recipes and is_recipe_row(row):
                skipped += 1
                continue
            name = fix_text_encoding((row.get("Food Name") or "").strip())
            day = (row.get("Day") or "").strip()
            if not name or not day:
                continue
            if not in_date_range(day, args.since, args.until):
                continue
            amount = row.get("Amount") or ""
            grams = parse_grams(amount)
            if grams is None:
                log_skipped += 1
                continue
            norm = normalize_name(name)
            pid = product_cache.get(norm)
            if pid is None:
                log_skipped += 1
                continue
            group_raw = (row.get("Group") or "uncategorized").strip().lower()
            meal = MEAL_MAP.get(group_raw, group_raw.replace(" ", "_")[:32])

            if args.dry_run:
                log_imported += 1
                continue

            conn.execute(
                """
                INSERT INTO nutrition_log (log_date, meal_group, product_id, grams)
                VALUES (%s::date, %s, %s, %s)
                """,
                (day, meal, pid, Decimal(str(grams))),
            )
            log_imported += 1

        if not args.dry_run:
            conn.commit()

    print(
        f"Products inserted: {products_inserted}, skipped existing: {products_skipped}, "
        f"log imported: {log_imported}, log skipped (no product/grams): {log_skipped}, "
        f"recipe rows skipped: {skipped}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
