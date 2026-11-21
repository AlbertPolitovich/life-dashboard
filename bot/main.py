import asyncio
import logging
import re
from datetime import date

from aiogram import Bot, Dispatcher, F, Router
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import CallbackQuery, Message

import app_context
from config import load_config
from dates_util import parse_date_input, parse_time_input
from fill_flow import (
    build_store,
    choose_day_for_track,
    start_filling_for_day,
)
from keyboards import (
    DATE_INPUT_HINT,
    FILL_DAY_QUESTION,
    TIME_INPUT_HINT,
    fill_day_keyboard,
    track_choice_keyboard,
)
from notifications_flow import (
    apply_notification_time,
    handle_notifications_back,
    handle_notifications_open,
    handle_notifications_test,
    handle_notifications_time_change,
    handle_notifications_toggle,
    run_reminder_tick,
)
from routine_flow import cancel_routine, handle_routine_answer
from sport_flow import (
    cancel_sport,
    handle_sport_block_answer,
    handle_sport_optional_minutes_no,
    handle_sport_skip,
    handle_sport_text_input,
)
from states import FillForm
from welcome import send_welcome

router = Router()

ROUTINE_CALLBACK = re.compile(r"^routine:\d+:[01]$")

HELP_TEXT = (
    "Я помогу заполнять life-dashboard через Telegram.\n\n"
    "Нажми /start — там «Заполнить» и 🔔.\n"
    "Заполнять удобнее утром: обратная связь за вчерашний день."
)


@router.message(CommandStart())
async def handle_start(message: Message) -> None:
    await send_welcome(message)


@router.message(Command("help"))
async def handle_help(message: Message) -> None:
    await message.answer(HELP_TEXT)


@router.message(Command("yesterday"))
async def handle_yesterday(message: Message) -> None:
    await message.answer("Что заполняем?", reply_markup=track_choice_keyboard())


@router.callback_query(F.data == "start:notifications")
async def handle_start_notifications(
    callback: CallbackQuery,
    state: FSMContext,
) -> None:
    await handle_notifications_open(callback, state)


@router.callback_query(F.data == "notif:toggle")
async def handle_notif_toggle(callback: CallbackQuery, state: FSMContext) -> None:
    await handle_notifications_toggle(callback, state)


@router.callback_query(F.data == "notif:time_change")
async def handle_notif_time_change(callback: CallbackQuery, state: FSMContext) -> None:
    await handle_notifications_time_change(callback, state)


@router.callback_query(F.data == "notif:time_manual")
async def handle_notif_time_manual_legacy(
    callback: CallbackQuery,
    state: FSMContext,
) -> None:
    # Backward compatibility for old messages with previous callback_data.
    await handle_notifications_time_change(callback, state)


@router.callback_query(F.data == "notif:test")
async def handle_notif_test(callback: CallbackQuery, bot: Bot) -> None:
    await handle_notifications_test(callback, bot)


@router.callback_query(F.data == "notif:back")
async def handle_notif_back(callback: CallbackQuery, state: FSMContext) -> None:
    await handle_notifications_back(callback, state)


@router.callback_query(F.data == "start:fill")
async def handle_start_fill(callback: CallbackQuery) -> None:
    await callback.answer()
    if callback.message:
        await callback.message.answer("Что заполняем?", reply_markup=track_choice_keyboard())


@router.callback_query(F.data.startswith("fill:date:"))
async def handle_fill_date(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    if not callback.message or not callback.data:
        return

    date_iso = callback.data.removeprefix("fill:date:")
    try:
        day = date.fromisoformat(date_iso)
    except ValueError:
        return

    data = await state.get_data()
    track = str(data.get("pending_track") or "")
    await start_filling_for_day(
        callback.message,
        day,
        state,
        track=track,
        store=app_context.sheets_store,
        edit_target=callback.message,
    )


@router.callback_query(F.data == "fill:pick_date")
async def handle_fill_pick_date(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    await state.set_state(FillForm.waiting_for_date)
    if callback.message:
        await callback.message.answer(DATE_INPUT_HINT)


@router.callback_query(F.data == "fill:cancel")
async def handle_fill_cancel(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    await state.clear()
    if callback.message:
        await send_welcome(callback.message)


@router.callback_query(F.data == "fill:track:routine")
async def handle_fill_track_routine(
    callback: CallbackQuery,
    state: FSMContext,
) -> None:
    await callback.answer()
    if not callback.message:
        return
    await choose_day_for_track(callback.message, state, track="routine")


@router.callback_query(F.data == "fill:track:sport")
async def handle_fill_track_sport(
    callback: CallbackQuery,
    state: FSMContext,
) -> None:
    await callback.answer()
    if not callback.message:
        return
    await choose_day_for_track(callback.message, state, track="sport")


@router.callback_query(F.data.regexp(r"^sport:(warmup|stretching):no$"))
async def handle_sport_optional_minutes_no_callback(
    callback: CallbackQuery,
    state: FSMContext,
) -> None:
    if not callback.data:
        return
    step = callback.data.split(":")[1]
    await handle_sport_optional_minutes_no(callback, state, step)


@router.callback_query(F.data.regexp(r"^sport:yn:(cycling|workout|running):(yes|no)$"))
async def handle_sport_yn(callback: CallbackQuery, state: FSMContext) -> None:
    if not callback.data:
        return
    parts = callback.data.split(":")
    if len(parts) != 4:
        return
    block = parts[2]
    yes = parts[3] == "yes"
    await handle_sport_block_answer(
        callback,
        state,
        app_context.sheets_store,
        block,
        yes=yes,
    )


@router.callback_query(F.data.startswith("sport:skip:"))
async def handle_sport_skip_callback(callback: CallbackQuery, state: FSMContext) -> None:
    if not callback.data:
        return
    step = callback.data.removeprefix("sport:skip:")
    await handle_sport_skip(callback, state, app_context.sheets_store, step)


@router.callback_query(F.data == "sport:cancel")
async def handle_sport_cancel(callback: CallbackQuery, state: FSMContext) -> None:
    await cancel_sport(callback, state)


@router.callback_query(F.data == "sport:offer:yes")
async def handle_sport_offer_yes(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    if not callback.message:
        return
    await choose_day_for_track(callback.message, state, track="sport")


@router.callback_query(F.data == "sport:offer:no")
async def handle_sport_offer_no(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    await state.clear()
    if callback.message:
        await send_welcome(callback.message)


@router.callback_query(F.data == "routine:cancel")
async def handle_routine_cancel(callback: CallbackQuery, state: FSMContext) -> None:
    await cancel_routine(callback, state)


@router.callback_query(F.data.regexp(ROUTINE_CALLBACK))
async def handle_routine_callback(callback: CallbackQuery, state: FSMContext) -> None:
    await handle_routine_answer(
        callback,
        state,
        app_context.sheets_store,
    )


@router.message(FillForm.waiting_for_date)
async def handle_custom_date_input(message: Message, state: FSMContext) -> None:
    day = parse_date_input(message.text or "")
    if day is None:
        await message.answer("Не понял дату.\n\n" + DATE_INPUT_HINT)
        return

    data = await state.get_data()
    track = str(data.get("pending_track") or "")
    await start_filling_for_day(
        message,
        day,
        state,
        track=track,
        store=app_context.sheets_store,
    )


@router.message(FillForm.waiting_for_notification_time)
async def handle_notification_time_input(message: Message, state: FSMContext) -> None:
    parsed = parse_time_input(message.text or "")
    if parsed is None:
        await message.answer("Не понял время.\n\n" + TIME_INPUT_HINT)
        return

    hour, minute = parsed
    await apply_notification_time(message, state, hour, minute)


@router.message(FillForm.filling_sport)
async def handle_sport_fill_message(message: Message, state: FSMContext) -> None:
    await handle_sport_text_input(message, state, app_context.sheets_store)


@router.message()
async def handle_message(message: Message, state: FSMContext) -> None:
    current = await state.get_state()
    if current == FillForm.choosing_track.state:
        await message.answer("Выбери Routine или Sport кнопкой. Или «Отмена».")
        return
    if current == FillForm.filling_routine.state:
        await message.answer("Выбери 0 или 1 кнопкой под вопросом. Или нажми «Отмена».")
        return
    if current == FillForm.offer_sport_after_routine.state:
        await message.answer('Нажми «Да» или «Нет» под вопросом «Заполнить Sport?».')
        return
    if current == FillForm.waiting_for_notification_time.state:
        await message.answer("Не понял время.\n\n" + TIME_INPUT_HINT)
        return
    if current == FillForm.configuring_notifications.state:
        await message.answer(
            "Используй кнопки ниже. Чтобы сменить время — нажми на строку с временем."
        )
        return
    await message.answer(
        "Нажми /start и выбери кнопку, или /yesterday для заполнения."
    )


async def reminder_loop(bot: Bot) -> None:
    while True:
        await asyncio.sleep(60)
        try:
            await run_reminder_tick(bot)
        except Exception:
            logging.exception("Reminder tick failed")


async def main() -> None:
    logging.basicConfig(level=logging.INFO)

    config = load_config()
    app_context.sheets_store = build_store(config)
    bot = Bot(token=config.bot_token)

    storage = MemoryStorage()
    dispatcher = Dispatcher(storage=storage)
    dispatcher.include_router(router)

    asyncio.create_task(reminder_loop(bot))
    await dispatcher.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
