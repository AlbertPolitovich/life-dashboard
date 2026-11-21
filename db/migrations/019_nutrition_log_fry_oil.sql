-- Жарка в дневнике (мясо/рыба): cook_mode=fry_meat + oil_grams.
-- лок.: docker exec -i life_dashboard_pg psql -U life -d life_dashboard < db/migrations/019_nutrition_log_fry_oil.sql
-- прод: docker exec -i life_dashboard_pg psql -U lifeapp -d life_dashboard < db/migrations/019_nutrition_log_fry_oil.sql

ALTER TABLE nutrition_log
    ADD COLUMN IF NOT EXISTS oil_grams NUMERIC(10, 2) NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'nutrition_log_oil_grams_check'
    ) THEN
        ALTER TABLE nutrition_log
            ADD CONSTRAINT nutrition_log_oil_grams_check CHECK (oil_grams >= 0);
    END IF;
END $$;

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
            'fry_meat'
        )
    );
