-- Разрешить source=lenta|lavka в food (как 28kcal 029_food_source_lenta_lavka).
-- лок.: docker exec -i life_dashboard_pg psql -U life -d life_dashboard < db/migrations/030_food_source_lenta_lavka.sql
-- прод: docker exec -i life_dashboard_pg psql -U lifeapp -d life_dashboard < db/migrations/030_food_source_lenta_lavka.sql
--
-- Дальше: скопировать food WHERE source IN ('lenta','lavka') из kcal_28
-- (см. deploy/import_lenta_lavka_from_kcal28.sh). Не трогать products / nutrition_log.

ALTER TABLE food DROP CONSTRAINT IF EXISTS food_source_check;
ALTER TABLE food
    ADD CONSTRAINT food_source_check
    CHECK (source IN (
        'vkusvill', 'perekrestok', 'generic', 'pyaterochka',
        'magnit', 'vkusnoitochka', 'shvili',
        'lenta', 'lavka'
    ));
