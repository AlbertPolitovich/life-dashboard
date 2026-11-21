-- Техобслуживание авто: актуальные интервалы масла + пробег по годам владения.
-- Локально:
--   docker exec -i life_dashboard_pg psql -U life -d life_dashboard < db/migrations/009_ledger_car_tech.sql

ALTER TABLE ledger_assets
    ADD COLUMN IF NOT EXISTS purchase_date DATE;

-- Последнее состояние по каждому расходнику (без истории замен).
CREATE TABLE IF NOT EXISTS ledger_car_maintenance (
    asset_id            INT NOT NULL REFERENCES ledger_assets (id) ON DELETE CASCADE,
    kind                TEXT NOT NULL CHECK (kind IN ('engine_oil', 'gearbox_oil')),
    last_odometer_km    INT NOT NULL CHECK (last_odometer_km >= 0),
    interval_km         INT NOT NULL CHECK (interval_km > 0),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (asset_id, kind)
);

-- Пробег за год владения (годовщина покупки → period_end).
CREATE TABLE IF NOT EXISTS ledger_car_mileage_years (
    asset_id            INT NOT NULL REFERENCES ledger_assets (id) ON DELETE CASCADE,
    period_end          DATE NOT NULL,
    km_driven           INT NOT NULL CHECK (km_driven >= 0),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (asset_id, period_end)
);

CREATE INDEX IF NOT EXISTS idx_ledger_car_mileage_years_asset
    ON ledger_car_mileage_years (asset_id, period_end);

-- Audi: данные из Ledger.xlsx · машина_напоминания (без импорта, сиды).
UPDATE ledger_assets
SET purchase_odometer_km = 257286,
    purchase_date = '2023-05-23',
    current_odometer_km = 292353,
    updated_at = now()
WHERE slug = 'audi';

INSERT INTO ledger_car_maintenance (asset_id, kind, last_odometer_km, interval_km)
SELECT a.id, v.kind, v.last_odometer_km, v.interval_km
FROM ledger_assets a
CROSS JOIN (
    VALUES
        ('engine_oil', 292353, 7500),
        ('gearbox_oil', 271000, 30000)
) AS v(kind, last_odometer_km, interval_km)
WHERE a.slug = 'audi'
ON CONFLICT (asset_id, kind) DO UPDATE SET
    last_odometer_km = EXCLUDED.last_odometer_km,
    interval_km = EXCLUDED.interval_km,
    updated_at = now();

INSERT INTO ledger_car_mileage_years (asset_id, period_end, km_driven)
SELECT a.id, v.period_end::date, v.km_driven
FROM ledger_assets a
CROSS JOIN (
    VALUES
        ('2024-05-23', 14919),
        ('2025-05-23', 12314),
        ('2026-05-23', 9481)
) AS v(period_end, km_driven)
WHERE a.slug = 'audi'
ON CONFLICT (asset_id, period_end) DO UPDATE SET
    km_driven = EXCLUDED.km_driven;
