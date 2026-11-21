from datetime import date, timedelta

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from dates_util import recent_fill_dates, short_label
from notifications_store import NotificationSettings
from sport_fields import SKIPPABLE_FIELD_STEPS

FILL_DAY_QUESTION = "За какой день заполняем?"

DATE_INPUT_HINT = (
    "Введи дату в формате ДД.ММ.ГГГГ\n"
    "Например: 17.05.2026\n\n"
    "Можно короче: ДД.ММ — тогда подставится текущий год."
)

TIME_INPUT_HINT = (
    "Введи время в формате ЧЧ:ММ\n"
    "Например: 08:30"
)


def start_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="Заполнить", callback_data="start:fill"),
                InlineKeyboardButton(
                    text="🔔",
                    callback_data="start:notifications",
                ),
            ],
        ]
    )


def fill_day_keyboard() -> InlineKeyboardMarkup:
    days = recent_fill_dates()
    buttons: list[InlineKeyboardButton] = []
    for day in days:
        label = short_label(day)
        if day == date.today() - timedelta(days=1):
            label = f"{label} (вчера)"
        buttons.append(
            InlineKeyboardButton(
                text=label,
                callback_data=f"fill:date:{day.isoformat()}",
            )
        )
    today = date.today()
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [buttons[0], buttons[1]],
            [
                InlineKeyboardButton(
                    text="🔥 Сегодня",
                    callback_data=f"fill:date:{today.isoformat()}",
                ),
                InlineKeyboardButton(
                    text="Ввести дату",
                    callback_data="fill:pick_date",
                ),
            ],
            [
                InlineKeyboardButton(
                    text="Отмена",
                    callback_data="fill:cancel",
                ),
            ],
        ]
    )


OFFER_SPORT_TEXT = "Заполнить Sport?"


def offer_sport_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Да",
                    callback_data="sport:offer:yes",
                ),
                InlineKeyboardButton(
                    text="Нет",
                    callback_data="sport:offer:no",
                ),
            ],
            [
                InlineKeyboardButton(
                    text="Отмена",
                    callback_data="fill:cancel",
                ),
            ],
        ]
    )


def track_choice_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Routine",
                    callback_data="fill:track:routine",
                ),
                InlineKeyboardButton(
                    text="Sport",
                    callback_data="fill:track:sport",
                ),
            ],
            [
                InlineKeyboardButton(
                    text="Отмена",
                    callback_data="fill:cancel",
                ),
            ],
        ]
    )


def sport_optional_minutes_keyboard(step: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Пропустить",
                    callback_data=f"sport:skip:{step}",
                ),
                InlineKeyboardButton(
                    text="Нет",
                    callback_data=f"sport:{step}:no",
                ),
            ],
            [
                InlineKeyboardButton(
                    text="Отмена",
                    callback_data="sport:cancel",
                ),
            ],
        ]
    )


def sport_warmup_keyboard() -> InlineKeyboardMarkup:
    return sport_optional_minutes_keyboard("warmup")


def sport_yes_no_keyboard(block: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Да",
                    callback_data=f"sport:yn:{block}:yes",
                ),
                InlineKeyboardButton(
                    text="Нет",
                    callback_data=f"sport:yn:{block}:no",
                ),
            ],
            [
                InlineKeyboardButton(
                    text="Отмена",
                    callback_data="sport:cancel",
                ),
            ],
        ]
    )


def sport_field_keyboard(step: str) -> InlineKeyboardMarkup:
    rows: list[list[InlineKeyboardButton]] = []
    if step in SKIPPABLE_FIELD_STEPS:
        rows.append(
            [
                InlineKeyboardButton(
                    text="Пропустить",
                    callback_data=f"sport:skip:{step}",
                ),
            ]
        )
    rows.append(
        [
            InlineKeyboardButton(
                text="Отмена",
                callback_data="sport:cancel",
            ),
        ]
    )
    return InlineKeyboardMarkup(inline_keyboard=rows)


def sphere_keyboard(sphere_index: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="0",
                    callback_data=f"routine:{sphere_index}:0",
                ),
                InlineKeyboardButton(
                    text="1",
                    callback_data=f"routine:{sphere_index}:1",
                ),
            ],
            [
                InlineKeyboardButton(
                    text="Отмена",
                    callback_data="routine:cancel",
                ),
            ],
        ]
    )


def time_button_label(hour: int, minute: int) -> str:
    return f"Время {hour:02d}:{minute:02d} (нажми — поменяем)"


def notifications_keyboard(settings: NotificationSettings) -> InlineKeyboardMarkup:
    toggle_label = (
        "✅ Уведомления включены"
        if settings.enabled
        else "⏸ Уведомления выключены"
    )
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=toggle_label,
                    callback_data="notif:toggle",
                ),
            ],
            [
                InlineKeyboardButton(
                    text=time_button_label(settings.hour, settings.minute),
                    callback_data="notif:time_change",
                ),
            ],
            [
                InlineKeyboardButton(
                    text="🔔 Проверить сейчас",
                    callback_data="notif:test",
                ),
            ],
            [
                InlineKeyboardButton(
                    text="← Назад",
                    callback_data="notif:back",
                ),
            ],
        ]
    )
