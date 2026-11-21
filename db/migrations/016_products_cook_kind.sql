-- cook_kind на кастомных products (как 28kcal 012).
-- Каталог food уже отдаёт cookKind; для Мои — опционально.

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS cook_kind TEXT
        CHECK (
            cook_kind IS NULL
            OR cook_kind IN ('pasta', 'grain', 'legume', 'meat_fish')
        );

CREATE INDEX IF NOT EXISTS idx_products_cook_kind
    ON products (cook_kind)
    WHERE cook_kind IS NOT NULL;
