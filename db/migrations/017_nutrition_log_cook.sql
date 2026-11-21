-- Готовка в дневнике: weighed_grams (что на весах) + cook_mode;
-- grams остаётся учётным (база КБЖУ = сырое/сухое на 100 г).
-- docker exec -i life_dashboard_pg psql -U lifeapp -d life_dashboard < db/migrations/017_nutrition_log_cook.sql

ALTER TABLE nutrition_log
    ADD COLUMN IF NOT EXISTS cook_mode TEXT;

ALTER TABLE nutrition_log
    ADD COLUMN IF NOT EXISTS weighed_grams NUMERIC(10, 2);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'nutrition_log_cook_mode_check'
    ) THEN
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
                    'stew_meat'
                )
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'nutrition_log_weighed_grams_check'
    ) THEN
        ALTER TABLE nutrition_log
            ADD CONSTRAINT nutrition_log_weighed_grams_check CHECK (
                weighed_grams IS NULL OR weighed_grams > 0
            );
    END IF;
END $$;
