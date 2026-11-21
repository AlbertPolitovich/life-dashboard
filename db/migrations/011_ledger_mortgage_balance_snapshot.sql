-- Снимок остатка долга из банка (опционально, если расчёт расходится на копейки).
ALTER TABLE ledger_mortgage_config
    ADD COLUMN IF NOT EXISTS principal_remaining_override NUMERIC(14, 2),
    ADD COLUMN IF NOT EXISTS principal_remaining_as_of DATE;
