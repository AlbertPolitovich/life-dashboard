-- Транспортный налог (из «Разное», не из топлива):
--   11.2024 misc 5332 → 169 + transport_tax 5163 (за 2023); fuel остаётся 6817
--   12.2025 misc 9752 → 900 + transport_tax 8852 (за 2024); fuel остаётся 4314
-- Месячные суммы ledger не меняются: 15442 / 14629.
--
-- ВАЖНО: НЕ создавать finance_transactions на эти суммы — они уже учтены в Финансах
-- внутри «Разное»/месячных импортов. Лишние ft ломают carryover (/finance/month → 503).
--
--   docker exec -i life_dashboard_pg psql -U lifeapp -d life_dashboard \
--     < db/migrations/031_ledger_transport_tax.sql

BEGIN;

-- --- Ноябрь 2024 ---
UPDATE ledger_allocations
SET amount = 6817, label = NULL, purpose = NULL
WHERE asset_id = (SELECT id FROM ledger_assets WHERE slug = 'audi')
  AND tx_date = '2024-11-01'
  AND bucket = 'consumables'
  AND sub_bucket = 'fuel'
  AND amount IN (1654, 6817);

UPDATE ledger_allocations
SET amount = 169
WHERE asset_id = (SELECT id FROM ledger_assets WHERE slug = 'audi')
  AND tx_date = '2024-11-01'
  AND bucket = 'consumables'
  AND sub_bucket = 'misc'
  AND amount IN (5332, 169);

INSERT INTO ledger_allocations (
    asset_id, finance_transaction_id, tx_date, amount, bucket, sub_bucket, label, purpose, source
)
SELECT a.id, NULL, '2024-11-01'::date, 5163, 'consumables', 'transport_tax',
       'Транспортный налог за 2023', '2023', 'ledger_import'
FROM ledger_assets a
WHERE a.slug = 'audi'
  AND NOT EXISTS (
      SELECT 1 FROM ledger_allocations x
      WHERE x.asset_id = a.id
        AND x.tx_date = '2024-11-01'
        AND x.bucket = 'consumables'
        AND x.sub_bucket = 'transport_tax'
        AND x.amount = 5163
  );

-- --- Декабрь 2025 ---
INSERT INTO ledger_allocations (
    asset_id, finance_transaction_id, tx_date, amount, bucket, sub_bucket, label, purpose, source
)
SELECT a.id, NULL, '2025-12-01'::date, 4314, 'consumables', 'fuel', NULL, NULL, 'ledger_import'
FROM ledger_assets a
WHERE a.slug = 'audi'
  AND NOT EXISTS (
      SELECT 1 FROM ledger_allocations x
      WHERE x.asset_id = a.id
        AND x.tx_date = '2025-12-01'
        AND x.bucket = 'consumables'
        AND x.sub_bucket = 'fuel'
  );

UPDATE ledger_allocations
SET amount = 900
WHERE asset_id = (SELECT id FROM ledger_assets WHERE slug = 'audi')
  AND tx_date = '2025-12-01'
  AND bucket = 'consumables'
  AND sub_bucket = 'misc'
  AND amount IN (9752, 5214, 900);

INSERT INTO ledger_allocations (
    asset_id, finance_transaction_id, tx_date, amount, bucket, sub_bucket, label, purpose, source
)
SELECT a.id, NULL, '2025-12-01'::date, 8852, 'consumables', 'transport_tax',
       'Транспортный налог за 2024', '2024', 'ledger_import'
FROM ledger_assets a
WHERE a.slug = 'audi'
  AND NOT EXISTS (
      SELECT 1 FROM ledger_allocations x
      WHERE x.asset_id = a.id
        AND x.tx_date = '2025-12-01'
        AND x.bucket = 'consumables'
        AND x.sub_bucket = 'transport_tax'
        AND x.amount = 8852
  );

-- Убрать ошибочные ft по налогу, если остались (ломали /finance/month)
UPDATE ledger_allocations
SET finance_transaction_id = NULL, source = 'ledger_import'
WHERE sub_bucket = 'transport_tax'
  AND finance_transaction_id IS NOT NULL
  AND EXISTS (
      SELECT 1 FROM finance_transactions ft
      WHERE ft.id = ledger_allocations.finance_transaction_id
        AND ft.income_note ILIKE '%Транспортный налог%'
  );

DELETE FROM finance_transactions
WHERE source = 'manual'
  AND income_note ILIKE '%Транспортный налог за 202%'
  AND amount IN (5163, 8852)
  AND NOT EXISTS (
      SELECT 1 FROM ledger_allocations x WHERE x.finance_transaction_id = finance_transactions.id
  );

COMMIT;
