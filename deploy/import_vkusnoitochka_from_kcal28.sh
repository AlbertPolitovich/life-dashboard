#!/usr/bin/env bash
# Скопировать food source=vkusnoitochka из kcal_28 → life_dashboard (тот же контейнер PG).
# INSERT only / ON CONFLICT DO NOTHING. category_id совпадают по slug.
#
#   ./deploy/import_vkusnoitochka_from_kcal28.sh          # с Mac через ssh-обёртку
#   # на VPS:
#   bash /opt/life-dashboard/deploy/import_vkusnoitochka_from_kcal28.sh
#   # или: ssh … bash -s < deploy/import_vkusnoitochka_from_kcal28.sh
set -euo pipefail

CONTAINER="${LIFE_PG_CONTAINER:-life_dashboard_pg}"
SRC_USER="${KCAL_PG_USER:-kcal}"
SRC_DB="${KCAL_PG_DB:-kcal_28}"
DST_USER="${LIFE_PG_USER:-lifeapp}"
DST_DB="${LIFE_PG_DB:-life_dashboard}"
CSV="/tmp/vkusnoitochka_food_lifeapp.csv"

COLS="source, external_id, variant_key, name, manufacturer_name, category_id, category_raw, is_private_label, private_label_brand, cook_kind, kcal_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g, fiber_per_100g, barcode, product_url, scraped_at, needs_review"

echo "→ export vkusnoitochka from ${SRC_DB}"
docker exec "$CONTAINER" psql -U "$SRC_USER" -d "$SRC_DB" -v ON_ERROR_STOP=1 \
  -c "\\copy (SELECT ${COLS} FROM food WHERE source = 'vkusnoitochka') TO '${CSV}' WITH (FORMAT csv, HEADER true)"

echo "→ import into ${DST_DB}"
docker exec -i "$CONTAINER" psql -U "$DST_USER" -d "$DST_DB" -v ON_ERROR_STOP=1 <<SQL
CREATE TEMP TABLE vkusnoitochka_import (
    source text,
    external_id text,
    variant_key text,
    name text,
    manufacturer_name text,
    category_id integer,
    category_raw text,
    is_private_label boolean,
    private_label_brand text,
    cook_kind text,
    kcal_per_100g numeric,
    protein_per_100g numeric,
    fat_per_100g numeric,
    carbs_per_100g numeric,
    fiber_per_100g numeric,
    barcode text,
    product_url text,
    scraped_at timestamptz,
    needs_review boolean
);
\\copy vkusnoitochka_import FROM '${CSV}' WITH (FORMAT csv, HEADER true)
INSERT INTO food (
    source, external_id, variant_key, name, manufacturer_name,
    category_id, category_raw, is_private_label, private_label_brand, cook_kind,
    kcal_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g, fiber_per_100g,
    barcode, product_url, scraped_at, needs_review, updated_at
)
SELECT
    source, external_id, variant_key, name, manufacturer_name,
    category_id, category_raw, is_private_label, private_label_brand, cook_kind,
    kcal_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g, fiber_per_100g,
    barcode, COALESCE(product_url, ''), scraped_at, needs_review, now()
FROM vkusnoitochka_import
ON CONFLICT (source, external_id, variant_key) DO NOTHING;
SELECT source, count(*) FROM food GROUP BY 1 ORDER BY 1;
SQL

docker exec "$CONTAINER" rm -f "$CSV" || true
echo "✓ vkusnoitochka import done"
