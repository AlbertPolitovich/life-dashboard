-- Финансы домохозяйства: категории, транзакции, план, напоминания.
-- На существующей БД: docker exec -i life_dashboard_pg psql -U life -d life_dashboard < db/migrations/003_finance.sql

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

-- Доходы
INSERT INTO finance_categories (slug, name, kind, group_name, color_key, is_fixed, sort_order) VALUES
    ('darya_photo',   'Дарья фото',    'income', NULL, NULL, false, 10),
    ('darya_salary',  'Дарья оклад',   'income', NULL, NULL, false, 20),
    ('artem_salary',  'Артём оклад',   'income', NULL, NULL, false, 30),
    ('artem_bonus',   'Артём бонус',   'income', NULL, NULL, false, 40),
    ('other',         'Прочее',        'income', NULL, NULL, false, 50),
    ('carryover',     'Остаток',       'carryover', NULL, NULL, false, 60)
ON CONFLICT (slug) DO NOTHING;

-- Расходы
INSERT INTO finance_categories (slug, name, kind, group_name, color_key, is_fixed, sort_order) VALUES
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
