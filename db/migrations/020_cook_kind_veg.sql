-- Овощи: cook_kind=veg + режимы пар/варка/жарка (факторы не как у мяса).
-- лок.: docker exec -i life_dashboard_pg psql -U life -d life_dashboard < db/migrations/020_cook_kind_veg.sql
-- прод: docker exec -i life_dashboard_pg psql -U lifeapp -d life_dashboard < db/migrations/020_cook_kind_veg.sql
-- Заморозка целиком не veg (пицца/пельмени) — смеси и брокколи по названию.

DO $$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT conrelid::regclass AS tbl, conname
        FROM pg_constraint
        WHERE contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%cook_kind%'
          AND pg_get_constraintdef(oid) ILIKE '%meat_fish%'
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname);
    END LOOP;
END $$;

ALTER TABLE food_categories
    ADD CONSTRAINT food_categories_cook_kind_check CHECK (
        cook_kind IS NULL
        OR cook_kind IN ('pasta', 'grain', 'legume', 'meat_fish', 'veg')
    );

ALTER TABLE food
    ADD CONSTRAINT food_cook_kind_check CHECK (
        cook_kind IS NULL
        OR cook_kind IN ('pasta', 'grain', 'legume', 'meat_fish', 'veg')
    );

ALTER TABLE products
    ADD CONSTRAINT products_cook_kind_check CHECK (
        cook_kind IS NULL
        OR cook_kind IN ('pasta', 'grain', 'legume', 'meat_fish', 'veg')
    );

UPDATE food_categories
SET cook_kind = 'veg'
WHERE slug = 'vegetables';

ALTER TABLE nutrition_log DROP CONSTRAINT IF EXISTS nutrition_log_cook_mode_check;

ALTER TABLE nutrition_log
    ADD CONSTRAINT nutrition_log_cook_mode_check CHECK (
        cook_mode IS NULL
        OR cook_mode IN (
            'plain',
            'boil_pasta',
            'boil_grain',
            'boil_legume',
            'steam_meat',
            'boil_meat',
            'stew_meat',
            'fry_meat',
            'steam_veg',
            'boil_veg',
            'fry_veg'
        )
    );
