from datetime import date

from aiogram import Bot
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, FSInputFile, Message

from charts import cleanup_rendered_image, render_routine_image
from data_store import GoogleSheetsStore, SheetsError
from dates_util import is_sunday
from sheets_errors import message_for_sheets_error
from keyboards import OFFER_SPORT_TEXT, offer_sport_keyboard, sphere_keyboard
from spheres import SPHERES
from states import FillForm
from welcome import send_welcome


async def begin_routine(
    message: Message,
    day: date,
    state: FSMContext,
    store: GoogleSheetsStore,
    *,
    row_1based: int,
) -> None:
    await state.set_state(FillForm.filling_routine)
    question = await message.answer(
        SPHERES[0].name,
        reply_markup=sphere_keyboard(0),
    )
    await state.update_data(
        date_iso=day.isoformat(),
        row_1based=row_1based,
        routine_answers=[],
        routine_chat_id=question.chat.id,
        routine_msg_id=question.message_id,
    )


async def cancel_routine(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    data = await state.get_data()
    await _delete_routine_message(callback.bot, data)
    await state.clear()
    if callback.message:
        await send_welcome(callback.message)


async def _delete_routine_message(bot: Bot, data: dict) -> None:
    chat_id = data.get("routine_chat_id")
    msg_id = data.get("routine_msg_id")
    if not chat_id or not msg_id:
        return
    try:
        await bot.delete_message(chat_id, msg_id)
    except Exception:
        pass


async def handle_routine_answer(
    callback: CallbackQuery,
    state: FSMContext,
    store: GoogleSheetsStore | None,
) -> None:
    if not callback.message or not callback.data or not callback.bot:
        return

    await callback.answer()

    parts = callback.data.split(":")
    if len(parts) != 3:
        return

    sphere_index = int(parts[1])
    value = int(parts[2])

    if sphere_index < 0 or sphere_index >= len(SPHERES):
        return
    if value not in (0, 1):
        return

    data = await state.get_data()
    date_iso = data.get("date_iso")
    row_1based = data.get("row_1based")
    if not date_iso or not row_1based:
        await state.clear()
        await callback.message.answer("Сессия сброшена. Нажми /start и начни снова.")
        return

    day = date.fromisoformat(date_iso)

    answers: list[int] = list(data.get("routine_answers", []))
    answers.append(value)
    await state.update_data(routine_answers=answers)

    next_index = sphere_index + 1
    if next_index < len(SPHERES):
        await callback.message.edit_text(
            SPHERES[next_index].name,
            reply_markup=sphere_keyboard(next_index),
        )
        return

    bot = callback.bot
    chat_id = callback.message.chat.id
    await _delete_routine_message(bot, data)

    if store is None:
        await state.clear()
        await bot.send_message(
            chat_id,
            "Таблица не подключена. Проверь SHEETS_API_URL в .env.",
        )
        return

    saving = await bot.send_message(chat_id, "Сохраняю в таблицу…")
    try:
        await store.write_routine_batch(day, answers, int(row_1based))
    except SheetsError as exc:
        await state.clear()
        await saving.delete()
        await bot.send_message(chat_id, message_for_sheets_error(exc, day))
        return
    await saving.delete()

    if is_sunday(day):
        rendered_path: str | None = None
        try:
            month_rows = await store.get_month_rows(day)
            rendered_path = await render_routine_image(month_rows)
            await bot.send_photo(
                chat_id,
                photo=FSInputFile(rendered_path),
                caption="Routine + Radar chart",
            )
        except Exception:
            # Chart preview is best-effort and should not block flow.
            pass
        finally:
            if rendered_path:
                cleanup_rendered_image(rendered_path)
    await state.set_state(FillForm.offer_sport_after_routine)
    await bot.send_message(
        chat_id,
        OFFER_SPORT_TEXT,
        reply_markup=offer_sport_keyboard(),
    )
