import logging
import os
from datetime import date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from aiogram import Bot
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from keyboards import notifications_keyboard
from notifications_store import get_settings, save_settings
from states import FillForm
from welcome import send_reminder, send_welcome

logger = logging.getLogger(__name__)

NOTIFICATIONS_INTRO = (
    "🔔 Настройка уведомлений\n\n"
    "Бот напоминает утром заполнить вчерашний день. "
    "Нажми на время — введи новое в чат (ЧЧ:ММ), уведомления включатся сами."
)

TIME_CHANGE_HINT = (
    "\n\n✏️ Введи новое время в чат (ЧЧ:ММ).\n"
    "После ввода уведомления включатся автоматически."
)

REMINDER_TEXT = (
    "🔔 Напоминание: пора заполнить вчерашний день.\n"
    "Нажми «Заполнить», когда будет удобно."
)

REMINDER_TZ_ENV = "REMINDER_TZ"
DEFAULT_REMINDER_TZ = "Europe/Moscow"


def _load_reminder_tz() -> ZoneInfo:
    tz_name = os.getenv(REMINDER_TZ_ENV, DEFAULT_REMINDER_TZ).strip() or DEFAULT_REMINDER_TZ
    try:
        return ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        logger.warning("Unknown timezone %r in %s; fallback to %s", tz_name, REMINDER_TZ_ENV, DEFAULT_REMINDER_TZ)
        return ZoneInfo(DEFAULT_REMINDER_TZ)


def _settings_text(settings, *, waiting_time: bool = False) -> str:
    tz_name = os.getenv(REMINDER_TZ_ENV, DEFAULT_REMINDER_TZ).strip() or DEFAULT_REMINDER_TZ
    status = "включены" if settings.enabled else "выключены"
    text = (
        NOTIFICATIONS_INTRO
        + f"\n\nСейчас уведомления {status}.\n"
        + f"Время: {settings.hour:02d}:{settings.minute:02d} ({tz_name})"
    )
    if waiting_time:
        text += TIME_CHANGE_HINT
    return text


async def show_notifications(
    message: Message,
    user_id: int,
    state: FSMContext,
) -> None:
    settings = get_settings(user_id)
    settings.chat_id = message.chat.id
    save_settings(user_id, settings)
    await state.set_state(FillForm.configuring_notifications)
    await message.answer(
        _settings_text(settings),
        reply_markup=notifications_keyboard(settings),
    )


async def handle_notifications_open(
    callback: CallbackQuery,
    state: FSMContext,
) -> None:
    await callback.answer()
    if not callback.message or not callback.from_user:
        return
    await show_notifications(callback.message, callback.from_user.id, state)


async def handle_notifications_toggle(
    callback: CallbackQuery,
    state: FSMContext,
) -> None:
    await callback.answer()
    if not callback.message or not callback.from_user:
        return

    user_id = callback.from_user.id
    settings = get_settings(user_id)
    settings.enabled = not settings.enabled
    settings.chat_id = callback.message.chat.id
    save_settings(user_id, settings)

    await state.set_state(FillForm.configuring_notifications)
    await callback.message.edit_text(
        _settings_text(settings),
        reply_markup=notifications_keyboard(settings),
    )


async def handle_notifications_time_change(
    callback: CallbackQuery,
    state: FSMContext,
) -> None:
    await callback.answer()
    if not callback.message or not callback.from_user:
        return

    user_id = callback.from_user.id
    settings = get_settings(user_id)
    settings.chat_id = callback.message.chat.id
    save_settings(user_id, settings)

    await state.set_state(FillForm.waiting_for_notification_time)
    await callback.message.edit_text(
        _settings_text(settings, waiting_time=True),
        reply_markup=notifications_keyboard(settings),
    )


async def apply_notification_time(
    message: Message,
    state: FSMContext,
    hour: int,
    minute: int,
) -> None:
    if not message.from_user:
        return

    user_id = message.from_user.id
    settings = get_settings(user_id)
    settings.hour = hour
    settings.minute = minute
    settings.enabled = True
    settings.chat_id = message.chat.id
    save_settings(user_id, settings)
    await state.set_state(FillForm.configuring_notifications)

    await message.answer(
        _settings_text(settings)
        + f"\n\n✅ Время {hour:02d}:{minute:02d} сохранено, уведомления включены.",
        reply_markup=notifications_keyboard(settings),
    )


async def handle_notifications_test(callback: CallbackQuery, bot: Bot) -> None:
    await callback.answer("Отправляю тестовое уведомление…")
    if not callback.from_user:
        return

    chat_id = callback.message.chat.id if callback.message else callback.from_user.id
    await send_reminder(bot, chat_id, caption=REMINDER_TEXT)


async def handle_notifications_back(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    await state.clear()
    if callback.message:
        await send_welcome(callback.message)


async def run_reminder_tick(bot: Bot) -> None:
    now = datetime.now(_load_reminder_tz())
    today = now.date().isoformat()

    for user_id, settings in iter_enabled_for_reminder_from_store():
        if settings.last_sent_date == today:
            continue
        if now.hour != settings.hour or now.minute != settings.minute:
            continue

        try:
            await send_reminder(bot, settings.chat_id, caption=REMINDER_TEXT)
            settings.last_sent_date = today
            save_settings(user_id, settings)
            logger.info("Reminder sent to user %s", user_id)
        except Exception:
            logger.exception("Failed to send reminder to user %s", user_id)


def iter_enabled_for_reminder_from_store():
    from notifications_store import iter_enabled_for_reminder

    return iter_enabled_for_reminder()
