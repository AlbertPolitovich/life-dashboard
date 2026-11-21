-- Дневник: одна plain-text запись на календарный день (как заметка Obsidian YYYY-MM-DD).
-- На существующей БД:
--   docker exec -i life_dashboard_pg psql -U life -d life_dashboard < db/migrations/005_diary.sql

CREATE TABLE IF NOT EXISTS diary_entries (
    entry_date  DATE PRIMARY KEY,
    body        TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diary_entries_month ON diary_entries (entry_date);
