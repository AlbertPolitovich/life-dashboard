from datetime import date

from data_store import SheetsError
from dates_util import short_label


def message_for_sheets_error(exc: SheetsError, day: date | None = None) -> str:
    code = str(exc).strip()
    label = short_label(day) if day else ""

    if code == "row_not_found":
        return (
            f"В таблице нет строки с датой {label}.\n\n"
            "Проверь колонку A на листе месяца (например 2026-05): "
            "дата должна быть там как 2026-05-18 или 18.05.2026.\n"
            "Или выбери дату кнопкой на экране выбора дня."
        )
    if code == "sheet_not_found":
        return (
            f"Нет вкладки месяца для даты {label}.\n\n"
            "В таблице должен быть лист с именем yyyy-MM, например 2026-05."
        )
    if code == "Unauthorized":
        return (
            "Секрет API не совпадает.\n\n"
            "Проверь SHEETS_API_SECRET в .env и BOT_API_SECRET в Apps Script."
        )
    if code.startswith("Таблица вернула не JSON"):
        return (
            "Таблица ответила не JSON — часто это старый деплой Apps Script.\n\n"
            "Extensions → Apps Script → Deploy → New version → Deploy."
        )
    return (
        "Не удалось связаться с таблицей.\n\n"
        "Проверь SHEETS_API_URL в .env и что Web App задеплоен с doPost."
    )
