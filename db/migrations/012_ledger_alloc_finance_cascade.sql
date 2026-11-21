-- Удаление finance_transactions каскадно убирает связанные ledger_allocations.
-- Локально:
--   docker exec -i life_dashboard_pg psql -U life -d life_dashboard < db/migrations/012_ledger_alloc_finance_cascade.sql

-- Осиротевшие finance_link после ON DELETE SET NULL
DELETE FROM ledger_allocations
WHERE source = 'finance_link'
  AND finance_transaction_id IS NULL;

ALTER TABLE ledger_allocations
    DROP CONSTRAINT IF EXISTS ledger_allocations_finance_transaction_id_fkey;

ALTER TABLE ledger_allocations
    ADD CONSTRAINT ledger_allocations_finance_transaction_id_fkey
    FOREIGN KEY (finance_transaction_id)
    REFERENCES finance_transactions (id)
    ON DELETE CASCADE;
