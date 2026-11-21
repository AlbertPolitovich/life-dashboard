-- Каталог food + XOR лог + избранное/заметки (single-user life-dashboard).
-- На проде:
--   docker exec -i life_dashboard_pg psql -U lifeapp -d life_dashboard < db/migrations/015_nutrition_food_catalog.sql
-- Затем импорт food_categories + food из kcal_28 (см. deploy notes).
--
-- ВАЖНО: НЕ делать `TRUNCATE food … CASCADE` — из‑за FK nutrition_log.food_id
-- CASCADE сотрёт весь nutrition_log (даже строки только с product_id).
-- Для перезаливки каталога: DROP/TRUNCATE только food(+categories), предварительно
-- сняв/отложив FK с nutrition_log, либо DELETE FROM food WHERE … без CASCADE на лог.

CREATE TABLE IF NOT EXISTS food_categories (
    id          SERIAL PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,
    name_ru     TEXT NOT NULL,
    cook_kind   TEXT CHECK (
        cook_kind IS NULL
        OR cook_kind IN ('pasta', 'grain', 'legume', 'meat_fish')
    ),
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS food (
    id                  SERIAL PRIMARY KEY,
    source              TEXT NOT NULL
                        CHECK (source IN ('vkusvill', 'perekrestok', 'generic', 'pyaterochka', 'magnit')),
    external_id         TEXT NOT NULL,
    variant_key         TEXT NOT NULL DEFAULT 'default',
    name                TEXT NOT NULL,
    manufacturer_name   TEXT,
    category_id         INTEGER REFERENCES food_categories (id) ON DELETE SET NULL,
    category_raw        TEXT,
    is_private_label    BOOLEAN NOT NULL DEFAULT false,
    private_label_brand TEXT,
    cook_kind           TEXT CHECK (
        cook_kind IS NULL
        OR cook_kind IN ('pasta', 'grain', 'legume', 'meat_fish')
    ),
    kcal_per_100g       NUMERIC(10, 2) CHECK (kcal_per_100g IS NULL OR kcal_per_100g >= 0),
    protein_per_100g    NUMERIC(10, 2) CHECK (protein_per_100g IS NULL OR protein_per_100g >= 0),
    fat_per_100g        NUMERIC(10, 2) CHECK (fat_per_100g IS NULL OR fat_per_100g >= 0),
    carbs_per_100g      NUMERIC(10, 2) CHECK (carbs_per_100g IS NULL OR carbs_per_100g >= 0),
    fiber_per_100g      NUMERIC(10, 2) CHECK (fiber_per_100g IS NULL OR fiber_per_100g >= 0),
    barcode             TEXT,
    product_url         TEXT NOT NULL DEFAULT '',
    scraped_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    needs_review        BOOLEAN NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source, external_id, variant_key)
);

CREATE INDEX IF NOT EXISTS idx_food_source ON food (source);
CREATE INDEX IF NOT EXISTS idx_food_name ON food (name);
CREATE INDEX IF NOT EXISTS idx_food_category ON food (category_id);
CREATE INDEX IF NOT EXISTS idx_food_cook_kind ON food (cook_kind) WHERE cook_kind IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_food_barcode ON food (barcode) WHERE barcode IS NOT NULL;

INSERT INTO food_categories (slug, name_ru, cook_kind, sort_order) VALUES
    ('pasta',           'Макароны',                    'pasta',     10),
    ('grains',          'Крупы и каши',                'grain',     20),
    ('legumes',         'Бобовые',                     'legume',    30),
    ('flour_baking',    'Мука и выпечка (сырьё)',      NULL,        40),
    ('oils_sauces',     'Масла, соусы, специи',        NULL,        50),
    ('meat',            'Мясо',                        'meat_fish', 60),
    ('chicken',         'Птица',                       'meat_fish', 70),
    ('fish_seafood',    'Рыба и морепродукты',         'meat_fish', 80),
    ('sausages_deli',   'Колбасы и деликатесы',        NULL,        90),
    ('dairy',           'Молоко и кисломолочное',      NULL,       100),
    ('cheese',          'Сыры',                        NULL,       110),
    ('eggs',            'Яйца',                        NULL,       120),
    ('vegetables',      'Овощи',                       NULL,       130),
    ('fruits_berries',  'Фрукты и ягоды',              NULL,       140),
    ('greens',          'Зелень',                      NULL,       150),
    ('mushrooms',       'Грибы',                       NULL,       160),
    ('pickles',         'Соленья и консервация',       NULL,       170),
    ('bread_bakery',    'Хлеб и пекарня',              NULL,       180),
    ('sweets',          'Сладости',                    NULL,       190),
    ('snacks',          'Снеки',                       NULL,       200),
    ('drinks',          'Напитки',                     NULL,       210),
    ('frozen',          'Заморозка',                   NULL,       220),
    ('ready_meals',     'Готовая еда',                 NULL,       230),
    ('baby_food',       'Детское питание',             NULL,       240),
    ('other',           'Прочее',                      NULL,       900)
ON CONFLICT (slug) DO UPDATE SET
    name_ru = EXCLUDED.name_ru,
    cook_kind = EXCLUDED.cook_kind,
    sort_order = EXCLUDED.sort_order;

-- last_serving для каталога (single-user)
CREATE TABLE IF NOT EXISTS food_preferences (
    food_id              INTEGER NOT NULL REFERENCES food (id) ON DELETE CASCADE,
    last_serving_grams   NUMERIC(10, 2)
        CHECK (last_serving_grams IS NULL OR last_serving_grams > 0),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (food_id)
);

-- Избранное + заметки
CREATE TABLE IF NOT EXISTS nutrition_item_meta (
    food_id     INTEGER REFERENCES food (id) ON DELETE CASCADE,
    product_id  INTEGER REFERENCES products (id) ON DELETE CASCADE,
    is_favorite BOOLEAN NOT NULL DEFAULT false,
    note        TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT nutrition_item_meta_xor CHECK (
        (food_id IS NOT NULL AND product_id IS NULL)
        OR (food_id IS NULL AND product_id IS NOT NULL)
    ),
    CONSTRAINT nutrition_item_meta_has_content CHECK (
        is_favorite OR (note IS NOT NULL AND length(btrim(note)) > 0)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS nutrition_item_meta_food_uidx
    ON nutrition_item_meta (food_id)
    WHERE food_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS nutrition_item_meta_product_uidx
    ON nutrition_item_meta (product_id)
    WHERE product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_nutrition_item_meta_favorites
    ON nutrition_item_meta (updated_at DESC)
    WHERE is_favorite;

-- Лог: XOR product | food
ALTER TABLE nutrition_log
    ADD COLUMN IF NOT EXISTS food_id INTEGER REFERENCES food (id) ON DELETE RESTRICT;

ALTER TABLE nutrition_log
    ALTER COLUMN product_id DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'nutrition_log_product_xor_food'
    ) THEN
        ALTER TABLE nutrition_log
            ADD CONSTRAINT nutrition_log_product_xor_food CHECK (
                (product_id IS NOT NULL AND food_id IS NULL)
                OR (product_id IS NULL AND food_id IS NOT NULL)
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_nutrition_log_food
    ON nutrition_log (food_id)
    WHERE food_id IS NOT NULL;
