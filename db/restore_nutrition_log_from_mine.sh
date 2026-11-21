#!/usr/bin/env bash
# Replace wrong kcal_28/food restore with Мои-product reconstruction
# from products.last_serving_grams + updated_at (real LD logging before wipe).
set -euo pipefail

docker exec -i life_dashboard_pg psql -U lifeapp -d life_dashboard -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;

-- 1) Drop wrong restore (catalog food rows + fake custom products from kcal_28)
DELETE FROM nutrition_log;

DELETE FROM nutrition_item_meta WHERE product_id BETWEEN 423 AND 430;
DELETE FROM products WHERE id BETWEEN 423 AND 430;

-- 2) Rebuild from Мои products touched before catalog truncate (~03:23 UTC Aug 5)
--    Meal inferred from Moscow local hour of last serving update.
INSERT INTO nutrition_log (log_date, meal_group, product_id, food_id, grams, created_at)
SELECT
  (p.updated_at AT TIME ZONE 'Europe/Moscow')::date AS log_date,
  CASE
    WHEN EXTRACT(HOUR FROM p.updated_at AT TIME ZONE 'Europe/Moscow') < 11 THEN 'breakfast'
    WHEN EXTRACT(HOUR FROM p.updated_at AT TIME ZONE 'Europe/Moscow') < 16 THEN 'lunch'
    WHEN EXTRACT(HOUR FROM p.updated_at AT TIME ZONE 'Europe/Moscow') < 21 THEN 'dinner'
    ELSE 'snack'
  END AS meal_group,
  p.id,
  NULL,
  p.last_serving_grams,
  p.updated_at
FROM products p
WHERE p.last_serving_grams IS NOT NULL
  AND p.updated_at >= TIMESTAMPTZ '2026-07-26 00:00:00+00'
  AND p.updated_at <  TIMESTAMPTZ '2026-08-05 03:20:00+00';

SELECT log_date, COUNT(*) AS n,
       ROUND(SUM(nl.grams * p.kcal_per_100g / 100.0)) AS kcal
FROM nutrition_log nl
JOIN products p ON p.id = nl.product_id
GROUP BY log_date
ORDER BY log_date DESC;

SELECT COUNT(*) AS total_rows,
       COUNT(*) FILTER (WHERE food_id IS NOT NULL) AS food_rows,
       COUNT(*) FILTER (WHERE product_id IS NOT NULL) AS product_rows
FROM nutrition_log;

COMMIT;
SQL
