"""Константы API — те же колонки, что в apps-script-doGet.gs (read-only дашборд)."""

# Sport by min (минуты): J, K, N, P, T
SPORT_MIN_COLS = (10, 11, 14, 16, 20)

# Sport by type (км): O, S
SPORT_TYPE_COLS = (15, 19)

# Плашки HR: R33, V33 → поля 18, 22 (среднее за месяц по дням)
SPORT_STAT_COLS: tuple[tuple[int, str], ...] = (
    (18, "hrRunning"),
    (22, "hrCycling"),
)

# Среднее по дням (не сумма): pace, HR, Wt
SPORT_AVG_COLS: frozenset[int] = frozenset({17, 18, 21, 22})

# Блоки экрана «Спорт» (detail)
SPORT_DETAIL_BLOCKS: tuple[tuple[str, str, tuple[int, ...]], ...] = (
    ("warmup-stretch", "Разминка · Растяжка", (10, 11)),
    ("cycling", "Вело", (19, 20, 21)),
    ("workout", "Воркаут", (14, 12, 13)),
    ("running", "Бег", (15, 16, 17, 18)),
)

# Все sport-цели из month_goals (2026)
SPORT_GOAL_COLS = (10, 11, 14, 15, 16, 19, 20)

# Итог минут KPI — как SPORT_ITOG_MINUTES_GOAL в Apps Script (опционально)
SPORT_ITOG_MINUTES_GOAL: dict[str, int] = {
    "2026-05": 1417,
}

SPORT_GOAL_MINUTES_FALLBACK: dict[str, int] = {
    "2026-05": 1417,
}

DEFAULT_ITOG_MINUTES = 1417
