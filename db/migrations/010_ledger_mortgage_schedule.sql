-- График платежей по ипотеке (Сапроново и др. apartment).
-- Локально:
--   docker exec -i life_dashboard_pg psql -U life -d life_dashboard < db/migrations/010_ledger_mortgage_schedule.sql

CREATE TABLE IF NOT EXISTS ledger_mortgage_schedule (
    id              SERIAL PRIMARY KEY,
    asset_id        INT NOT NULL REFERENCES ledger_assets (id) ON DELETE CASCADE,
    payment_no      INT NOT NULL,
    due_date        DATE NOT NULL,
    payment_total   NUMERIC(12, 2) NOT NULL,
    principal_part  NUMERIC(12, 2) NOT NULL,
    interest_part   NUMERIC(12, 2) NOT NULL,
    balance_after   NUMERIC(14, 2) NOT NULL,
    UNIQUE (asset_id, payment_no)
);

CREATE INDEX IF NOT EXISTS idx_ledger_mortgage_schedule_asset
    ON ledger_mortgage_schedule (asset_id, payment_no);
