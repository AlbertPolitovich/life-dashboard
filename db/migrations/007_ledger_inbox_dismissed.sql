-- Транзакции Финансов, уже учтённые в ledger_import — не показывать в inbox.
CREATE TABLE IF NOT EXISTS ledger_inbox_dismissed (
    finance_transaction_id INT PRIMARY KEY
        REFERENCES finance_transactions (id) ON DELETE CASCADE,
    dismissed_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Бэклог на момент включения inbox (excel_import + ручные до авто-связки).
INSERT INTO ledger_inbox_dismissed (finance_transaction_id)
SELECT ft.id
FROM finance_transactions ft
JOIN finance_categories fc ON fc.id = ft.category_id
WHERE fc.slug IN ('ipoteka', 'dom_remont', 'kvartplata', 'avto')
ON CONFLICT DO NOTHING;
