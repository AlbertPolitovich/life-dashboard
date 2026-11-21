-- Разрешить source=shvili в food (как 28kcal 028_food_source_shvili).
-- лок.: docker exec -i life_dashboard_pg psql -U life -d life_dashboard < db/migrations/029_food_source_shvili.sql
-- прод: docker exec -i life_dashboard_pg psql -U lifeapp -d life_dashboard < db/migrations/029_food_source_shvili.sql
--
-- Дальше: скопировать food WHERE source='shvili' из kcal_28
-- (см. deploy/import_shvili_from_kcal28.sh). Не трогать products / nutrition_log.

ALTER TABLE food DROP CONSTRAINT IF EXISTS food_source_check;
ALTER TABLE food
    ADD CONSTRAINT food_source_check
    CHECK (source IN (
        'vkusvill', 'perekrestok', 'generic', 'pyaterochka',
        'magnit', 'vkusnoitochka', 'shvili'
    ));
