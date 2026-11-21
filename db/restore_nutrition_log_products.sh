#!/usr/bin/env bash
# Finish product-row restore after food rows already imported.
set -euo pipefail

docker exec -i life_dashboard_pg psql -U lifeapp -d life_dashboard -v ON_ERROR_STOP=1 <<'SQL'
CREATE TEMP TABLE kcal_prods (
  kcal_id int,
  name text,
  kcal numeric,
  protein numeric,
  fat numeric,
  carbs numeric,
  fiber numeric
);
\copy kcal_prods FROM '/tmp/nl_prods.csv' WITH (FORMAT csv, HEADER false)

CREATE TEMP TABLE kcal_prod_map (kcal_id int PRIMARY KEY, ld_id int NOT NULL);

INSERT INTO kcal_prod_map (kcal_id, ld_id)
SELECT k.kcal_id, p.id
FROM kcal_prods k
JOIN LATERAL (
  SELECT id FROM products
  WHERE lower(trim(name)) = lower(trim(k.name))
  ORDER BY id
  LIMIT 1
) p ON true;

INSERT INTO products (
  name, name_normalized,
  kcal_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g, fiber_per_100g
)
SELECT
  k.name,
  lower(trim(k.name)),
  k.kcal, k.protein, k.fat, k.carbs, k.fiber
FROM kcal_prods k
WHERE NOT EXISTS (SELECT 1 FROM kcal_prod_map m WHERE m.kcal_id = k.kcal_id)
ON CONFLICT (name_normalized) DO NOTHING;

INSERT INTO kcal_prod_map (kcal_id, ld_id)
SELECT k.kcal_id, p.id
FROM kcal_prods k
JOIN LATERAL (
  SELECT id FROM products
  WHERE name_normalized = lower(trim(k.name))
     OR lower(trim(name)) = lower(trim(k.name))
  ORDER BY id DESC
  LIMIT 1
) p ON true
WHERE NOT EXISTS (SELECT 1 FROM kcal_prod_map m WHERE m.kcal_id = k.kcal_id);

CREATE TEMP TABLE nl_prod_import (
  log_date date,
  meal_group text,
  grams numeric,
  kcal_product_id int,
  created_at timestamptz
);
\copy nl_prod_import FROM '/tmp/nl_prod_log.csv' WITH (FORMAT csv, HEADER false)

INSERT INTO nutrition_log (log_date, meal_group, grams, product_id, food_id, created_at)
SELECT i.log_date, i.meal_group, i.grams, m.ld_id, NULL, i.created_at
FROM nl_prod_import i
JOIN kcal_prod_map m ON m.kcal_id = i.kcal_product_id
WHERE NOT EXISTS (
  SELECT 1 FROM nutrition_log x
  WHERE x.log_date = i.log_date
    AND x.meal_group = i.meal_group
    AND x.product_id = m.ld_id
    AND x.grams = i.grams
);

SELECT 'map' AS kind, m.kcal_id, m.ld_id, p.name
FROM kcal_prod_map m
JOIN products p ON p.id = m.ld_id
ORDER BY m.kcal_id;

SELECT log_date, COUNT(*) AS n,
  COUNT(*) FILTER (WHERE product_id IS NOT NULL) AS prod,
  COUNT(*) FILTER (WHERE food_id IS NOT NULL) AS food
FROM nutrition_log
WHERE log_date >= CURRENT_DATE - 10
GROUP BY log_date
ORDER BY log_date DESC;

SELECT COUNT(*) AS total_log FROM nutrition_log;
SQL
