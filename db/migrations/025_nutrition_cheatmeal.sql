-- Читмил / рефид: ручной override таргетов на день (не из спорта).
-- лок.: docker exec -i life_dashboard_pg psql -U life -d life_dashboard < db/migrations/025_nutrition_cheatmeal.sql
-- прод: docker exec -i life_dashboard_pg psql -U lifeapp -d life_dashboard < db/migrations/025_nutrition_cheatmeal.sql

INSERT INTO nutrition_targets (
    sport_day_kind,
    calories_target, protein_target, fat_target, carbs_target, fiber_target,
    calories_min, calories_max,
    protein_min, protein_max,
    fat_min, fat_max,
    carbs_min, carbs_max
) VALUES
    ('cheatmeal', 2650, 150, 65, 360, 30, 2600, 2700, 150, 150, 60, 70, 340, 380)
ON CONFLICT (sport_day_kind) DO UPDATE SET
    calories_target = EXCLUDED.calories_target,
    protein_target = EXCLUDED.protein_target,
    fat_target = EXCLUDED.fat_target,
    carbs_target = EXCLUDED.carbs_target,
    fiber_target = EXCLUDED.fiber_target,
    calories_min = EXCLUDED.calories_min,
    calories_max = EXCLUDED.calories_max,
    protein_min = EXCLUDED.protein_min,
    protein_max = EXCLUDED.protein_max,
    fat_min = EXCLUDED.fat_min,
    fat_max = EXCLUDED.fat_max,
    carbs_min = EXCLUDED.carbs_min,
    carbs_max = EXCLUDED.carbs_max;

CREATE TABLE IF NOT EXISTS nutrition_day_flags (
    log_date    DATE PRIMARY KEY,
    cheatmeal   BOOLEAN NOT NULL DEFAULT false,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
