-- Дата напоминания (конкретный день, не только число месяца).
ALTER TABLE finance_reminders
    ADD COLUMN IF NOT EXISTS due_date DATE;

-- Ближайшее наступление day_of_month для существующих записей.
UPDATE finance_reminders r
SET due_date = d.candidate
FROM (
    SELECT
        id,
        CASE
            WHEN (
                make_date(
                    EXTRACT(YEAR FROM CURRENT_DATE)::int,
                    EXTRACT(MONTH FROM CURRENT_DATE)::int,
                    LEAST(
                        day_of_month,
                        EXTRACT(
                            DAY FROM (
                                DATE_TRUNC('month', CURRENT_DATE)
                                + INTERVAL '1 month'
                                - INTERVAL '1 day'
                            )
                        )::int
                    )
                )
            ) >= CURRENT_DATE THEN make_date(
                EXTRACT(YEAR FROM CURRENT_DATE)::int,
                EXTRACT(MONTH FROM CURRENT_DATE)::int,
                LEAST(
                    day_of_month,
                    EXTRACT(
                        DAY FROM (
                            DATE_TRUNC('month', CURRENT_DATE)
                            + INTERVAL '1 month'
                            - INTERVAL '1 day'
                        )
                    )::int
                )
            )
            ELSE make_date(
                EXTRACT(YEAR FROM (CURRENT_DATE + INTERVAL '1 month'))::int,
                EXTRACT(MONTH FROM (CURRENT_DATE + INTERVAL '1 month'))::int,
                LEAST(
                    day_of_month,
                    EXTRACT(
                        DAY FROM (
                            DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month')
                            + INTERVAL '1 month'
                            - INTERVAL '1 day'
                        )
                    )::int
                )
            )
        END AS candidate
    FROM finance_reminders
    WHERE due_date IS NULL
) d
WHERE r.id = d.id AND r.due_date IS NULL;
