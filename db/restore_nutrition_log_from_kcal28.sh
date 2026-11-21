#!/usr/bin/env bash
# Restore last 10 days of nutrition_log into life_dashboard from kcal_28.
set -euo pipefail

echo "=== export from kcal_28 ==="
docker exec life_dashboard_pg psql -U lifeapp -d kcal_28 -v ON_ERROR_STOP=1 \
  -c "\\copy (
    SELECT log_date, meal_group, grams, food_id, created_at
    FROM nutrition_log
    WHERE food_id IS NOT NULL AND log_date >= CURRENT_DATE - 10
    ORDER BY id
  ) TO '/tmp/nl_food.csv' WITH (FORMAT csv, HEADER false)"

docker exec life_dashboard_pg psql -U lifeapp -d kcal_28 -v ON_ERROR_STOP=1 \
  -c "\\copy (
    SELECT id, name, kcal_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g, COALESCE(fiber_per_100g,0)
    FROM products
    WHERE id IN (
      SELECT DISTINCT product_id FROM nutrition_log
      WHERE product_id IS NOT NULL AND log_date >= CURRENT_DATE - 10
    )
    ORDER BY id
  ) TO '/tmp/nl_prods.csv' WITH (FORMAT csv, HEADER false)"

docker exec life_dashboard_pg psql -U lifeapp -d kcal_28 -v ON_ERROR_STOP=1 \
  -c "\\copy (
    SELECT log_date, meal_group, grams, product_id, created_at
    FROM nutrition_log
    WHERE product_id IS NOT NULL AND log_date >= CURRENT_DATE - 10
    ORDER BY id
  ) TO '/tmp/nl_prod_log.csv' WITH (FORMAT csv, HEADER false)"

docker exec life_dashboard_pg wc -l /tmp/nl_food.csv /tmp/nl_prods.csv /tmp/nl_prod_log.csv

echo "=== import food rows ==="
docker exec -i life_dashboard_pg psql -U lifeapp -d life_dashboard -v ON_ERROR_STOP=1 <<'SQL'
CREATE TEMP TABLE nl_food_import (
  log_date date,
  meal_group text,
  grams numeric,
  food_id int,
  created_at timestamptz
);
\copy nl_food_import FROM '/tmp/nl_food.csv' WITH (FORMAT csv, HEADER false)
INSERT INTO nutrition_log (log_date, meal_group, grams, food_id, product_id, created_at)
SELECT i.log_date, i.meal_group, i.grams, i.food_id, NULL, i.created_at
FROM nl_food_import i
WHERE NOT EXISTS (
  SELECT 1 FROM nutrition_log x
  WHERE x.log_date = i.log_date
    AND x.meal_group = i.meal_group
    AND x.food_id = i.food_id
    AND x.grams = i.grams
);
SELECT 'food_src' AS step, COUNT(*) FROM nl_food_import;
SQL

echo "=== import product rows ==="
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

INSERT INTO products (name, kcal_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g, fiber_per_100g)
SELECT k.name, k.kcal, k.protein, k.fat, k.carbs, k.fiber
FROM kcal_prods k
WHERE NOT EXISTS (SELECT 1 FROM kcal_prod_map m WHERE m.kcal_id = k.kcal_id);

INSERT INTO kcal_prod_map (kcal_id, ld_id)
SELECT k.kcal_id, p.id
FROM kcal_prods k
JOIN LATERAL (
  SELECT id FROM products
  WHERE lower(trim(name)) = lower(trim(k.name))
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

SELECT 'map' AS kind, * FROM kcal_prod_map ORDER BY kcal_id;
SELECT log_date, COUNT(*) AS n,
  COUNT(*) FILTER (WHERE product_id IS NOT NULL) AS prod,
  COUNT(*) FILTER (WHERE food_id IS NOT NULL) AS food
FROM nutrition_log
WHERE log_date >= CURRENT_DATE - 10
GROUP BY log_date
ORDER BY log_date DESC;
SELECT COUNT(*) AS total_log FROM nutrition_log;
SQL

echo "=== done ==="
