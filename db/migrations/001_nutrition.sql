-- Питание: продукты (КБЖУ на 100 г), дневной лог (граммы), таргеты по типу спорт-дня.
-- На существующей БД: docker exec -i life_dashboard_pg psql -U life -d life_dashboard < db/migrations/001_nutrition.sql

CREATE TABLE IF NOT EXISTS products (
    id                  SERIAL PRIMARY KEY,
    name                TEXT NOT NULL,
    name_normalized     TEXT NOT NULL UNIQUE,
    kcal_per_100g       NUMERIC(10, 2) NOT NULL CHECK (kcal_per_100g >= 0),
    protein_per_100g    NUMERIC(10, 2) NOT NULL CHECK (protein_per_100g >= 0),
    fat_per_100g        NUMERIC(10, 2) NOT NULL CHECK (fat_per_100g >= 0),
    carbs_per_100g      NUMERIC(10, 2) NOT NULL CHECK (carbs_per_100g >= 0),
    fiber_per_100g      NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (fiber_per_100g >= 0),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nutrition_log (
    id          SERIAL PRIMARY KEY,
    log_date    DATE NOT NULL,
    meal_group  VARCHAR(32) NOT NULL,
    product_id  INTEGER NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    grams       NUMERIC(10, 2) NOT NULL CHECK (grams > 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nutrition_log_date ON nutrition_log (log_date);
CREATE INDEX IF NOT EXISTS idx_nutrition_log_product ON nutrition_log (product_id);

-- sport_day_kind: rest | workout | cycling | running (как bot/kbju.py)
-- targets — середина диапазонов из напоминаний бота; fiber_target = 30 г/день
CREATE TABLE IF NOT EXISTS nutrition_targets (
    sport_day_kind   VARCHAR(16) PRIMARY KEY,
    calories_target  NUMERIC(10, 2) NOT NULL,
    protein_target   NUMERIC(10, 2) NOT NULL,
    fat_target       NUMERIC(10, 2) NOT NULL,
    carbs_target     NUMERIC(10, 2) NOT NULL,
    fiber_target     NUMERIC(10, 2) NOT NULL DEFAULT 30,
    calories_min     NUMERIC(10, 2),
    calories_max     NUMERIC(10, 2),
    protein_min      NUMERIC(10, 2),
    protein_max      NUMERIC(10, 2),
    fat_min          NUMERIC(10, 2),
    fat_max          NUMERIC(10, 2),
    carbs_min        NUMERIC(10, 2),
    carbs_max        NUMERIC(10, 2)
);

INSERT INTO nutrition_targets (
    sport_day_kind,
    calories_target, protein_target, fat_target, carbs_target, fiber_target,
    calories_min, calories_max,
    protein_min, protein_max,
    fat_min, fat_max,
    carbs_min, carbs_max
) VALUES
    ('rest', 2000, 145, 70, 190, 30, 1950, 2050, 140, 150, 65, 75, 180, 200),
    ('workout', 2150, 150, 70, 225, 30, 2100, 2200, 145, 155, 65, 75, 210, 240),
    ('cycling', 2300, 145, 70, 320, 30, 2200, 2400, 140, 150, 65, 75, 300, 340),
    ('running', 2075, 145, 70, 240, 30, 2000, 2150, 140, 150, 65, 75, 220, 260)
ON CONFLICT (sport_day_kind) DO NOTHING;
