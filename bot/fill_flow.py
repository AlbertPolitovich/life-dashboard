import logging
from datetime import date

from aiogram.fsm.context import FSMContext
from aiogram.types import Message

from config import Config
from data_store import GoogleSheetsStore, SheetsError
from dates_util import full_label
from sheets_errors import message_for_sheets_error
from states import FillForm

logger = logging.getLogger(__name__)


def build_store(config: Config) -> GoogleSheetsStore | None:
    if not config.sheets_api_url:
        return None
    return GoogleSheetsStore(config.sheets_api_url, config.sheets_api_secret)


async def _reply(
    message: Message,
    text: str,
    *,
    edit_target: Message | None = None,
) -> None:
    if edit_target:
        await edit_target.edit_text(text)
    else:
        await message.answer(text)


async def start_filling_for_day(
    message: Message,
    day: date,
    state: FSMContext,
    *,
    track: str,
    store: GoogleSheetsStore | None,
    edit_target: Message | None = None,
) -> None:
    if store is None:
        await state.clear()
        await _reply(
            message,
            "Таблица не подключена.\n\nДобавь SHEETS_API_URL в файл .env "
            "(тот же URL /exec, что в index.html).",
            edit_target=edit_target,
        )
        return

    checking = await message.answer("Проверяю дату в таблице…")
    try:
        prepared = await store.prepare_day(day)
    except SheetsError as exc:
        logger.warning("prepare_day failed for %s: %s", day.isoformat(), exc)
        await state.clear()
        await checking.delete()
        await _reply(
            message,
            message_for_sheets_error(exc, day),
            edit_target=edit_target,
        )
        return
    await checking.delete()

    if edit_target:
        try:
            await edit_target.edit_reply_markup(reply_markup=None)
        except Exception:
            pass

    await state.clear()
    await state.update_data(
        date_iso=prepared.date_iso,
        row_1based=prepared.row_1based,
    )

    if track == "routine":
        from routine_flow import begin_routine

        await begin_routine(
            message,
            day,
            state,
            store,
            row_1based=prepared.row_1based,
        )
        return

    if track == "sport":
        from sport_flow import begin_sport

        await begin_sport(message, day, state)
        return

    await state.clear()
    label = full_label(day)
    await message.answer(f"{label}\n\nСессия сброшена. Нажми /start и начни снова.")


async def start_routine_for_prepared_day(
    message: Message,
    state: FSMContext,
    store: GoogleSheetsStore,
) -> None:
    data = await state.get_data()
    date_iso = data.get("date_iso")
    row_1based = data.get("row_1based")
    if not date_iso or not row_1based:
        await state.clear()
        await message.answer("Сессия сброшена. Нажми /start и начни снова.")
        return

    from routine_flow import begin_routine

    day = date.fromisoformat(date_iso)
    await begin_routine(
        message,
        day,
        state,
        store,
        row_1based=int(row_1based),
    )


async def start_sport_for_prepared_day(
    message: Message,
    state: FSMContext,
) -> None:
    data = await state.get_data()
    date_iso = data.get("date_iso")
    if not date_iso:
        await state.clear()
        await message.answer("Сессия сброшена. Нажми /start и начни снова.")
        return

    from sport_flow import begin_sport

    day = date.fromisoformat(date_iso)
    await begin_sport(message, day, state)


async def choose_day_for_track(
    message: Message,
    state: FSMContext,
    *,
    track: str,
) -> None:
    from keyboards import FILL_DAY_QUESTION, fill_day_keyboard

    await state.set_state(FillForm.waiting_for_date)
    await state.update_data(pending_track=track)
    await message.answer(
        FILL_DAY_QUESTION,
        reply_markup=fill_day_keyboard(),
    )
