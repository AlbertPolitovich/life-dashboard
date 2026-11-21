-- Разрешить source=vkusnoitochka в food (как 28kcal 027_food_source_vkusnoitochka).
-- лок.: docker exec -i life_dashboard_pg psql -U life -d life_dashboard < db/migrations/028_food_source_vkusnoitochka.sql
-- прод: docker exec -i life_dashboard_pg psql -U lifeapp -d life_dashboard < db/migrations/028_food_source_vkusnoitochka.sql
--
-- Дальше: скопировать food WHERE source='vkusnoitochka' из kcal_28
-- (см. deploy/import_vkusnoitochka_from_kcal28.sh). Не трогать products / nutrition_log.

ALTER TABLE food DROP CONSTRAINT IF EXISTS food_source_check;
ALTER TABLE food
    ADD CONSTRAINT food_source_check
    CHECK (source IN ('vkusvill', 'perekrestok', 'generic', 'pyaterochka', 'magnit', 'vkusnoitochka'));
