-- Разрешить source=magnit в food (как 28kcal 025_food_source_magnit).
-- лок.: docker exec -i life_dashboard_pg psql -U life -d life_dashboard < db/migrations/026_food_source_magnit.sql
-- прод: docker exec -i life_dashboard_pg psql -U lifeapp -d life_dashboard < db/migrations/026_food_source_magnit.sql
--
-- Дальше: скопировать food WHERE source='magnit' из kcal_28 (см. deploy/import_magnit_from_kcal28.sh).
-- Не трогать products / nutrition_log.

ALTER TABLE food DROP CONSTRAINT IF EXISTS food_source_check;
ALTER TABLE food
    ADD CONSTRAINT food_source_check
    CHECK (source IN ('vkusvill', 'perekrestok', 'generic', 'pyaterochka', 'magnit'));
