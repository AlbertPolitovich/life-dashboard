-- Схема life-dashboard (путь A). Применяется при первом docker compose up.
-- Повторно на уже существующем volume: psql ... -f db/schema.sql

-- Месяц (лист «2026-05» в Google Sheets)
CREATE TABLE IF NOT EXISTS months (
    id          SERIAL PRIMARY KEY,
    year_month  VARCHAR(7) NOT NULL UNIQUE  -- '2026-05'
);

-- Один календарный день
CREATE TABLE IF NOT EXISTS days (
    id          SERIAL PRIMARY KEY,
    month_id    INTEGER NOT NULL REFERENCES months (id) ON DELETE CASCADE,
    day_date    DATE NOT NULL UNIQUE,
    UNIQUE (month_id, day_date)
);

-- Routine: 8 сфер B–I. sphere = номер колонки листа (2…9), value = 0 или 1
CREATE TABLE IF NOT EXISTS routine_values (
    day_id  INTEGER NOT NULL REFERENCES days (id) ON DELETE CASCADE,
    sphere  SMALLINT NOT NULL CHECK (sphere BETWEEN 2 AND 9),
    value   SMALLINT NOT NULL CHECK (value IN (0, 1)),
    PRIMARY KEY (day_id, sphere)
);

-- Sport: поля J–V (код поля — текст, значение — число или pace)
CREATE TABLE IF NOT EXISTS sport_values (
    day_id  INTEGER NOT NULL REFERENCES days (id) ON DELETE CASCADE,
    field   VARCHAR(32) NOT NULL,
    value   TEXT NOT NULL,
    PRIMARY KEY (day_id, field)
);

-- Цели месяца: kind=goal, target_key = номер колонки листа (2–9 routine, 10–22 sport)
CREATE TABLE IF NOT EXISTS month_goals (
    month_id    INTEGER NOT NULL REFERENCES months (id) ON DELETE CASCADE,
    kind        VARCHAR(8) NOT NULL CHECK (kind IN ('fact', 'goal')),
    target_key  VARCHAR(32) NOT NULL,
    value       NUMERIC,
    PRIMARY KEY (month_id, kind, target_key)
);

CREATE INDEX IF NOT EXISTS idx_days_month_id ON days (month_id);
CREATE INDEX IF NOT EXISTS idx_routine_values_day_id ON routine_values (day_id);
CREATE INDEX IF NOT EXISTS idx_sport_values_day_id ON sport_values (day_id);

-- Питание: КБЖУ на 100 г, лог в граммах, таргеты по типу спорт-дня (см. db/migrations/001_nutrition.sql)
CREATE TABLE IF NOT EXISTS products (
    id                  SERIAL PRIMARY KEY,
    name                TEXT NOT NULL,
    name_normalized     TEXT NOT NULL UNIQUE,
    kcal_per_100g       NUMERIC(10, 2) NOT NULL CHECK (kcal_per_100g >= 0),
    protein_per_100g    NUMERIC(10, 2) NOT NULL CHECK (protein_per_100g >= 0),
    fat_per_100g        NUMERIC(10, 2) NOT NULL CHECK (fat_per_100g >= 0),
    carbs_per_100g      NUMERIC(10, 2) NOT NULL CHECK (carbs_per_100g >= 0),
    fiber_per_100g      NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (fiber_per_100g >= 0),
    last_serving_grams  NUMERIC(10, 2) CHECK (last_serving_grams IS NULL OR last_serving_grams > 0),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nutrition_log (
    id          SERIAL PRIMARY KEY,
    log_date    DATE NOT NULL,
    meal_group  VARCHAR(32) NOT NULL,
    product_id  INTEGER NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    grams       NUMERIC(10, 2) NOT NULL CHECK (grams > 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nutrition_log_date ON nutrition_log (log_date);
CREATE INDEX IF NOT EXISTS idx_nutrition_log_product ON nutrition_log (product_id);

CREATE TABLE IF NOT EXISTS nutrition_targets (
    sport_day_kind   VARCHAR(16) PRIMARY KEY,
    calories_target  NUMERIC(10, 2) NOT NULL,
    protein_target   NUMERIC(10, 2) NOT NULL,
    fat_target       NUMERIC(10, 2) NOT NULL,
    carbs_target     NUMERIC(10, 2) NOT NULL,
    fiber_target     NUMERIC(10, 2) NOT NULL DEFAULT 30,
    calories_min     NUMERIC(10, 2),
    calories_max     NUMERIC(10, 2),
    protein_min      NUMERIC(10, 2),
    protein_max      NUMERIC(10, 2),
    fat_min          NUMERIC(10, 2),
    fat_max          NUMERIC(10, 2),
    carbs_min        NUMERIC(10, 2),
    carbs_max        NUMERIC(10, 2)
);

INSERT INTO nutrition_targets (
    sport_day_kind,
    calories_target, protein_target, fat_target, carbs_target, fiber_target,
    calories_min, calories_max,
    protein_min, protein_max,
    fat_min, fat_max,
    carbs_min, carbs_max
) VALUES
    ('rest', 1700, 150, 80, 135, 30, 1650, 1750, 145, 155, 75, 85, 120, 150),
    ('workout', 2100, 155, 80, 205, 30, 2050, 2150, 150, 160, 75, 85, 190, 220),
    ('cycling', 2325, 150, 65, 285, 30, 2250, 2400, 145, 155, 60, 70, 250, 320),
    ('cycling_long', 2600, 155, 65, 345, 30, 2500, 2700, 150, 160, 60, 70, 310, 380),
    ('running', 2025, 150, 65, 210, 30, 1950, 2100, 145, 155, 60, 70, 190, 230),
    ('cheatmeal', 2650, 150, 65, 360, 30, 2600, 2700, 150, 150, 60, 70, 340, 380)
ON CONFLICT (sport_day_kind) DO NOTHING;

-- Ручной читмил на конкретный день (не трогает classify_sport_day).
CREATE TABLE IF NOT EXISTS nutrition_day_flags (
    log_date    DATE PRIMARY KEY,
    cheatmeal   BOOLEAN NOT NULL DEFAULT false,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Финансы (см. db/migrations/003_finance.sql)
CREATE TABLE IF NOT EXISTS finance_categories (
    id          SERIAL PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'carryover')),
    group_name  TEXT,
    color_key   TEXT,
    is_fixed    BOOLEAN NOT NULL DEFAULT false,
    is_system   BOOLEAN NOT NULL DEFAULT true,
    sort_order  INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS finance_transactions (
    id           SERIAL PRIMARY KEY,
    tx_date      DATE NOT NULL,
    category_id  INT NOT NULL REFERENCES finance_categories (id),
    amount       NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    income_note  TEXT,
    source       TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'excel_import')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_finance_tx_date ON finance_transactions (tx_date);
CREATE INDEX IF NOT EXISTS idx_finance_tx_category ON finance_transactions (category_id);
CREATE TABLE IF NOT EXISTS finance_monthly_plan (
    year_month       VARCHAR(7) NOT NULL,
    category_id      INT NOT NULL REFERENCES finance_categories (id),
    amount_planned   NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (amount_planned >= 0),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (year_month, category_id)
);

CREATE TABLE IF NOT EXISTS finance_reminders (
    id             SERIAL PRIMARY KEY,
    day_of_month   SMALLINT NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
    category_id    INT REFERENCES finance_categories (id) ON DELETE SET NULL,
    label          TEXT NOT NULL,
    amount_hint    NUMERIC(12, 2),
    is_active      BOOLEAN NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO finance_categories (slug, name, kind, group_name, color_key, is_fixed, sort_order) VALUES
    ('darya_photo',   'Дарья фото',    'income', NULL, NULL, false, 10),
    ('darya_salary',  'Дарья оклад',   'income', NULL, NULL, false, 20),
    ('artem_salary',  'Артём оклад',   'income', NULL, NULL, false, 30),
    ('artem_bonus',   'Артём бонус',   'income', NULL, NULL, false, 40),
    ('other',         'Прочее',        'income', NULL, NULL, false, 50),
    ('carryover',     'Остаток',       'carryover', NULL, NULL, false, 60),
    ('ipoteka',           'Ипотека',                    'expense', 'Обязательные',   'blue',   true,  110),
    ('kvartplata',        'Кварплата',                  'expense', 'Обязательные',   'blue',   true,  120),
    ('svyaz',             'Связь',                      'expense', 'Обязательные',   'blue',   true,  130),
    ('eda',               'Еда',                        'expense', 'Питание',        'green',  false, 210),
    ('kafe',              'Кафе и рестораны',           'expense', 'Питание',        'green',  false, 220),
    ('avto',              'Автомобиль',                 'expense', 'Транспорт',      'orange', false, 310),
    ('proezd',            'Проезд',                     'expense', 'Транспорт',      'orange', false, 320),
    ('taksi',             'Такси и каршеринг',          'expense', 'Транспорт',      'orange', false, 330),
    ('dom_remont',        'Для дома (ремонт)',          'expense', 'Дом',            'purple', false, 410),
    ('technika',          'Техника',                    'expense', 'Дом',            'purple', false, 420),
    ('rebenok',           'Ребёнок',                    'expense', 'Семья',          'pink',   false, 510),
    ('nakopleniya_dasha', 'Накопления Даша',            'expense', 'Семья',          'pink',   false, 520),
    ('podarki',           'Подарки',                    'expense', 'Семья',          'pink',   false, 530),
    ('zdorovie',          'Здоровье',                   'expense', 'Здоровье/спорт', 'yellow', false, 610),
    ('krasota',           'Красота и стрижки',          'expense', 'Здоровье/спорт', 'yellow', false, 620),
    ('sport',             'Спорт',                      'expense', 'Здоровье/спорт', 'yellow', false, 630),
    ('obuchenie',         'Обучение',                   'expense', 'Развитие',       'teal',   false, 710),
    ('razvlecheniya',     'Развлечения',                'expense', 'Развитие',       'teal',   false, 720),
    ('internet',          'Интернет подписки',          'expense', 'Развитие',       'teal',   false, 730),
    ('assets_10',         'Активы 10% (инвестиции)',    'expense', 'Активы',         'gray',   false, 810),
    ('nalogi',            'Налоги',                     'expense', 'Активы',         'gray',   false, 820),
    ('biznes',            'Продвижение и бизнес',       'expense', 'Активы',         'gray',   false, 830),
    ('raznoe',            'Разное',                     'expense', 'Активы',         'gray',   false, 840),
    ('odezhda',           'Одежда',                     'expense', 'Активы',         'gray',   false, 850),
    ('otpusk',            'Отпуск',                     'expense', 'Активы',         'gray',   false, 860)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO finance_reminders (day_of_month, category_id, label, amount_hint)
SELECT 15, c.id, 'Ипотека', 64000
FROM finance_categories c
WHERE c.slug = 'ipoteka'
  AND NOT EXISTS (SELECT 1 FROM finance_reminders r WHERE r.label = 'Ипотека');

INSERT INTO finance_reminders (day_of_month, category_id, label, amount_hint)
SELECT 1, c.id, 'Кварплата', 9500
FROM finance_categories c
WHERE c.slug = 'kvartplata'
  AND NOT EXISTS (SELECT 1 FROM finance_reminders r WHERE r.label = 'Кварплата');

INSERT INTO finance_reminders (day_of_month, category_id, label, amount_hint)
SELECT 1, c.id, 'Связь', 1820
FROM finance_categories c
WHERE c.slug = 'svyaz'
  AND NOT EXISTS (SELECT 1 FROM finance_reminders r WHERE r.label = 'Связь');

INSERT INTO finance_reminders (day_of_month, category_id, label, amount_hint)
SELECT 1, c.id, 'Интернет подписки', 3599
FROM finance_categories c
WHERE c.slug = 'internet'
  AND NOT EXISTS (SELECT 1 FROM finance_reminders r WHERE r.label = 'Интернет подписки');

-- Дневник (см. db/migrations/005_diary.sql)
CREATE TABLE IF NOT EXISTS diary_entries (
    entry_date  DATE PRIMARY KEY,
    body        TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diary_entries_month ON diary_entries (entry_date);
