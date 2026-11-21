-- Блюда: снимок КБЖУ в products (Мои) + состав ингредиентов.
-- лок.: docker exec -i life_dashboard_pg psql -U life -d life_dashboard < db/migrations/018_dishes.sql
-- прод: docker exec -i life_dashboard_pg psql -U lifeapp -d life_dashboard < db/migrations/018_dishes.sql

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS is_dish BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS dish_yield_grams NUMERIC(10, 2)
    CHECK (dish_yield_grams IS NULL OR dish_yield_grams > 0);

CREATE INDEX IF NOT EXISTS idx_products_is_dish
    ON products (id)
    WHERE is_dish;

CREATE TABLE IF NOT EXISTS dish_items (
    id                      SERIAL PRIMARY KEY,
    product_id              INTEGER NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    food_id                 INTEGER REFERENCES food (id) ON DELETE RESTRICT,
    ingredient_product_id   INTEGER REFERENCES products (id) ON DELETE RESTRICT,
    grams                   NUMERIC(10, 2) NOT NULL CHECK (grams > 0),
    cook_mode               TEXT NOT NULL DEFAULT 'plain',
    oil_grams               NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (oil_grams >= 0),
    sort_order              INTEGER NOT NULL DEFAULT 0,
    CHECK (
        (food_id IS NOT NULL AND ingredient_product_id IS NULL)
        OR (food_id IS NULL AND ingredient_product_id IS NOT NULL)
    ),
    CHECK (ingredient_product_id IS NULL OR ingredient_product_id <> product_id)
);

CREATE INDEX IF NOT EXISTS idx_dish_items_product ON dish_items (product_id);
CREATE INDEX IF NOT EXISTS idx_dish_items_food ON dish_items (food_id)
    WHERE food_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dish_items_ingredient ON dish_items (ingredient_product_id)
    WHERE ingredient_product_id IS NOT NULL;
