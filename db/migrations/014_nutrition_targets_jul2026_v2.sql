-- КБЖУ: жиры/углеводы для вело и бега (июль 2026 v2).
-- На проде: docker exec -i life_dashboard_pg psql -U lifeapp -d life_dashboard < db/migrations/014_nutrition_targets_jul2026_v2.sql

INSERT INTO nutrition_targets (
    sport_day_kind,
    calories_target, protein_target, fat_target, carbs_target, fiber_target,
    calories_min, calories_max,
    protein_min, protein_max,
    fat_min, fat_max,
    carbs_min, carbs_max
) VALUES
    ('rest', 1700, 150, 80, 135, 30, 1650, 1750, 145, 155, 75, 85, 120, 150),
    ('workout', 2100, 155, 80, 205, 30, 2050, 2150, 150, 160, 75, 85, 190, 220),
    ('cycling', 2325, 150, 65, 285, 30, 2250, 2400, 145, 155, 60, 70, 250, 320),
    ('cycling_long', 2600, 155, 65, 345, 30, 2500, 2700, 150, 160, 60, 70, 310, 380),
    ('running', 2025, 150, 65, 210, 30, 1950, 2100, 145, 155, 60, 70, 190, 230)
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
