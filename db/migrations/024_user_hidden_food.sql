-- Скрыть food из каталога после «Изменить КБЖУ» → свой продукт.
-- Single-user: user_id всегда 1 (таблицы users нет).
-- лок.: docker exec -i life_dashboard_pg psql -U life -d life_dashboard < db/migrations/024_user_hidden_food.sql
-- прод: docker exec -i life_dashboard_pg psql -U lifeapp -d life_dashboard < db/migrations/024_user_hidden_food.sql

CREATE TABLE IF NOT EXISTS user_hidden_food (
    user_id     INTEGER NOT NULL DEFAULT 1,
    food_id     INTEGER NOT NULL REFERENCES food (id) ON DELETE CASCADE,
    product_id  INTEGER NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, food_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS user_hidden_food_user_product_uidx
    ON user_hidden_food (user_id, product_id);

CREATE INDEX IF NOT EXISTS idx_user_hidden_food_user
    ON user_hidden_food (user_id);
