-- Упрощение taxonomy сервиса Audi: purpose → 3 группы, unit → 5 узлов.
-- Локально:
--   docker exec -i life_dashboard_pg psql -U life -d life_dashboard < db/migrations/008_ledger_service_taxonomy.sql

-- purpose: repair | service | misc
UPDATE ledger_allocations
SET purpose = 'misc'
WHERE bucket = 'service'
  AND purpose IN ('stuff', 'cosmetic', 'other');

UPDATE ledger_allocations
SET purpose = 'service'
WHERE bucket = 'service'
  AND purpose = 'consumables';

-- unit: maintenance (бывш. consumables в service), chassis ← brakes/gearbox
UPDATE ledger_allocations
SET sub_bucket = 'maintenance'
WHERE bucket = 'service'
  AND sub_bucket = 'consumables';

UPDATE ledger_allocations
SET sub_bucket = 'chassis'
WHERE bucket = 'service'
  AND sub_bucket IN ('brakes', 'gearbox');

UPDATE ledger_allocations
SET sub_bucket = 'general'
WHERE bucket = 'service'
  AND (sub_bucket IS NULL OR sub_bucket = '');

UPDATE ledger_allocations
SET purpose = 'service'
WHERE bucket = 'service'
  AND sub_bucket = 'maintenance'
  AND purpose NOT IN ('repair', 'service', 'misc');

UPDATE ledger_allocations
SET purpose = 'repair'
WHERE bucket = 'service'
  AND purpose NOT IN ('repair', 'service', 'misc');
