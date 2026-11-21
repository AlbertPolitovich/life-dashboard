-- Вернуть суффикс «Перекресток» в name для catalog perekrestok (как в 28kcal).
-- лок./прод: docker exec -i life_dashboard_pg psql -U … -d life_dashboard < db/migrations/027_perek_name_suffix.sql

UPDATE food
SET name = trim(trailing FROM name) || ' Перекресток',
    updated_at = now()
WHERE source = 'perekrestok'
  AND name !~* ' Перекресток[[:space:]]*$'
  AND name !~* ' Перекрёсток[[:space:]]*$';
