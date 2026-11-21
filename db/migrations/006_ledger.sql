-- Ledger (хозяйство): объекты (квартиры, авто) + распределение трат поверх finance_transactions.
-- Локально:
--   docker exec -i life_dashboard_pg psql -U life -d life_dashboard < db/migrations/006_ledger.sql

CREATE TABLE IF NOT EXISTS ledger_assets (
    id                  SERIAL PRIMARY KEY,
    kind                TEXT NOT NULL CHECK (kind IN ('apartment', 'car')),
    slug                TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    sort_order          INT NOT NULL DEFAULT 0,
    purchase_odometer_km INT,
    current_odometer_km  INT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_allocations (
    id                      SERIAL PRIMARY KEY,
    asset_id                INT NOT NULL REFERENCES ledger_assets (id) ON DELETE RESTRICT,
    finance_transaction_id  INT REFERENCES finance_transactions (id) ON DELETE CASCADE,
    tx_date                 DATE NOT NULL,
    amount                  NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    bucket                  TEXT NOT NULL,
    sub_bucket              TEXT,
    label                   TEXT,
    purpose                 TEXT,
    source                  TEXT NOT NULL DEFAULT 'manual'
        CHECK (source IN ('finance_link', 'ledger_import', 'manual')),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_alloc_asset ON ledger_allocations (asset_id);
CREATE INDEX IF NOT EXISTS idx_ledger_alloc_date ON ledger_allocations (tx_date);
CREATE INDEX IF NOT EXISTS idx_ledger_alloc_bucket ON ledger_allocations (asset_id, bucket);
CREATE INDEX IF NOT EXISTS idx_ledger_alloc_finance_tx ON ledger_allocations (finance_transaction_id);

CREATE TABLE IF NOT EXISTS ledger_mortgage_config (
    asset_id            INT PRIMARY KEY REFERENCES ledger_assets (id) ON DELETE CASCADE,
    principal_initial   NUMERIC(14, 2) NOT NULL,
    down_payment        NUMERIC(14, 2) NOT NULL DEFAULT 0,
    annual_rate_pct     NUMERIC(8, 4) NOT NULL,
    monthly_payment     NUMERIC(12, 2) NOT NULL,
    loan_start_date     DATE NOT NULL,
    extra_payments_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_maintenance_events (
    id                  SERIAL PRIMARY KEY,
    asset_id            INT NOT NULL REFERENCES ledger_assets (id) ON DELETE CASCADE,
    kind                TEXT NOT NULL
        CHECK (kind IN ('engine_oil', 'gearbox_oil', 'purchase', 'other')),
    done_odometer_km    INT NOT NULL,
    done_date           DATE NOT NULL,
    next_odometer_km    INT,
    label               TEXT NOT NULL,
    source              TEXT NOT NULL DEFAULT 'manual'
        CHECK (source IN ('ledger_import', 'manual')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_maint_asset ON ledger_maintenance_events (asset_id, done_date DESC);

-- Стартовые объекты
INSERT INTO ledger_assets (kind, slug, name, sort_order, purchase_odometer_km, current_odometer_km)
VALUES
    ('apartment', 'sapronovo', 'Сапроново', 10, NULL, NULL),
    ('car', 'audi', 'Audi', 20, 257286, 292353)
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    purchase_odometer_km = COALESCE(EXCLUDED.purchase_odometer_km, ledger_assets.purchase_odometer_km),
    current_odometer_km = COALESCE(EXCLUDED.current_odometer_km, ledger_assets.current_odometer_km),
    updated_at = now();
