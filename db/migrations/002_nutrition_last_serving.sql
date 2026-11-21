-- Последняя порция (г) при добавлении в дневник — для автоподстановки в mini-app.
-- docker exec -i life_dashboard_pg psql -U life -d life_dashboard < db/migrations/002_nutrition_last_serving.sql

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS last_serving_grams NUMERIC(10, 2)
    CHECK (last_serving_grams IS NULL OR last_serving_grams > 0);
