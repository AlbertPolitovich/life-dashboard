-- Проверка целей месяца (подставьте year_month)
-- routine: target_key 2–9  |  sport: 10, 11, 14, 15, 16, 19, 20
-- В 2026 ожидается 15 строк kind=goal

SELECT
  m.year_month,
  g.target_key,
  g.value,
  CASE
    WHEN g.target_key::int BETWEEN 2 AND 9 THEN 'routine'
    WHEN g.target_key::int IN (10, 11, 14, 15, 16, 19, 20) THEN 'sport'
    ELSE 'other'
  END AS block
FROM month_goals g
JOIN months m ON m.id = g.month_id
WHERE m.year_month = '2026-05'
  AND g.kind = 'goal'
ORDER BY block, g.target_key::int;
