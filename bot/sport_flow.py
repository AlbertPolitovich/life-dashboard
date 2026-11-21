from datetime import date
from typing import Any

from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, FSInputFile, InlineKeyboardMarkup, Message

from charts import cleanup_rendered_image, render_sport_image
from data_store import GoogleSheetsStore, SheetsError
from kbju import KBJU_PARSE_MODE, kbju_reminder_text
from dates_util import full_label, is_sunday
from keyboards import (
    sport_field_keyboard,
    sport_optional_minutes_keyboard,
    sport_yes_no_keyboard,
)
from pace_util import apply_computed_pace
from sheets_errors import message_for_sheets_error
from sport_fields import (
    FIELD_STEP_TO_FIELD,
    OPTIONAL_MINUTES_STEPS,
    SKIPPABLE_FIELD_STEPS,
    STRETCH_FIELD,
    STRETCH_STEP,
    WARMUP_FIELD,
    WARMUP_STEP,
)
from sport_parse import parse_sport_number
from states import FillForm
from welcome import send_welcome

SPORT_VALUE_HINT = (
    "Введи число ≥ 0. Дробная часть через запятую (например 6,7). "
    "0 — если не было."
)

TEXT_WARMUP = "Была разминка? Если да, напиши сколько минут"
TEXT_STRETCHING = "Была растяжка? Если да, напиши сколько минут"
TEXT_CYCLING_YN = "Был велоспорт?"
TEXT_WORKOUT_YN = "Был воркаут?"
TEXT_RUNNING_YN = "Был бег?"


def _next_after_optional_minutes(step: str) -> str:
    if step == WARMUP_STEP:
        return STRETCH_STEP
    if step == STRETCH_STEP:
        return "cycling_yn"
    raise ValueError(step)


def _pending_dict(data: dict) -> dict[int, Any]:
    raw = data.get("sport_pending") or {}
    return {int(k): v for k, v in raw.items()}


def _pending_to_state(pending: dict[int, Any]) -> dict[str, Any]:
    return {str(k): v for k, v in pending.items()}


async def _session_day_row(state: FSMContext) -> tuple[date, int] | None:
    data = await state.get_data()
    date_iso = data.get("date_iso")
    row_1based = data.get("row_1based")
    if not date_iso or not row_1based:
        return None
    return date.fromisoformat(date_iso), int(row_1based)


def _step_prompt(step: str) -> tuple[str, InlineKeyboardMarkup | None]:
    if step == WARMUP_STEP:
        return TEXT_WARMUP, sport_optional_minutes_keyboard(WARMUP_STEP)
    if step == STRETCH_STEP:
        return TEXT_STRETCHING, sport_optional_minutes_keyboard(STRETCH_STEP)
    if step == "cycling_yn":
        return TEXT_CYCLING_YN, sport_yes_no_keyboard("cycling")
    if step == "workout_yn":
        return TEXT_WORKOUT_YN, sport_yes_no_keyboard("workout")
    if step == "running_yn":
        return TEXT_RUNNING_YN, sport_yes_no_keyboard("running")
    if step in FIELD_STEP_TO_FIELD:
        field = FIELD_STEP_TO_FIELD[step]
        return field.label, sport_field_keyboard(step)
    raise ValueError(f"unknown sport step: {step}")


async def _clear_markup(message: Message | None) -> None:
    if not message:
        return
    try:
        await message.edit_reply_markup(reply_markup=None)
    except Exception:
        pass


async def _send_step(
    state: FSMContext,
    step: str,
    target: Message,
    *,
    clear_markup_on: Message | None = None,
) -> None:
    await _clear_markup(clear_markup_on)
    text, markup = _step_prompt(step)
    await target.answer(text, reply_markup=markup)
    await state.update_data(sport_step=step)


def _next_field_step(current: str) -> str | None:
    steps = list(FIELD_STEP_TO_FIELD.keys())
    idx = steps.index(current)
    if idx + 1 < len(steps):
        return steps[idx + 1]
    return None


def _first_field_of_block(block: str) -> str:
    if block == "cycling":
        return "cycling_km"
    if block == "workout":
        return "workout_min"
    if block == "running":
        return "running_km"
    raise ValueError(block)


def _last_field_of_block(block: str) -> str:
    if block == "cycling":
        return "cycling_hr"
    if block == "workout":
        return "pull_ups"
    if block == "running":
        return "running_hr"
    raise ValueError(block)


def _block_of_field_step(step: str) -> str | None:
    if step.startswith("cycling_") and step != "cycling_yn":
        return "cycling"
    if step in ("workout_min", "push_ups", "pull_ups"):
        return "workout"
    if step.startswith("running_") and step != "running_yn":
        return "running"
    return None


async def _advance_from_step(
    message: Message,
    state: FSMContext,
    current_step: str,
    store: GoogleSheetsStore | None,
) -> None:
    block = _block_of_field_step(current_step)
    if block is None:
        return

    if current_step != _last_field_of_block(block):
        nxt = _next_field_step(current_step)
        if nxt:
            await _send_step(state, nxt, message)
        return

    if block == "cycling":
        await _send_step(state, "workout_yn", message)
    elif block == "workout":
        await _send_step(state, "running_yn", message)
    elif block == "running":
        await _finish_sport_session(message, state, store)


async def begin_sport(message: Message, day: date, state: FSMContext) -> None:
    await state.set_state(FillForm.filling_sport)
    label = full_label(day)
    text, markup = _step_prompt("warmup")
    await message.answer(f"{label}\n\n{text}", reply_markup=markup)
    await state.update_data(sport_pending={}, sport_step="warmup")


async def handle_sport_optional_minutes_no(
    callback: CallbackQuery,
    state: FSMContext,
    step: str,
) -> None:
    if not callback.message or step not in OPTIONAL_MINUTES_STEPS:
        return
    await callback.answer()
    await _send_step(
        state,
        _next_after_optional_minutes(step),
        callback.message,
        clear_markup_on=callback.message,
    )


async def handle_sport_skip(
    callback: CallbackQuery,
    state: FSMContext,
    store: GoogleSheetsStore | None,
    step: str,
) -> None:
    if not callback.message:
        return
    await callback.answer()

    data = await state.get_data()
    if data.get("sport_step") != step or step not in SKIPPABLE_FIELD_STEPS:
        return

    await _clear_markup(callback.message)
    if step in OPTIONAL_MINUTES_STEPS:
        await _send_step(
            state,
            _next_after_optional_minutes(step),
            callback.message,
        )
        return
    await _advance_from_step(callback.message, state, step, store)


async def handle_sport_block_answer(
    callback: CallbackQuery,
    state: FSMContext,
    store: GoogleSheetsStore | None,
    block: str,
    *,
    yes: bool,
) -> None:
    if not callback.message:
        return
    await callback.answer()

    if yes:
        await _send_step(
            state,
            _first_field_of_block(block),
            callback.message,
            clear_markup_on=callback.message,
        )
        return

    if block == "cycling":
        await _send_step(
            state,
            "workout_yn",
            callback.message,
            clear_markup_on=callback.message,
        )
    elif block == "workout":
        await _send_step(
            state,
            "running_yn",
            callback.message,
            clear_markup_on=callback.message,
        )
    elif block == "running":
        await _finish_sport_session(callback.message, state, store)


async def handle_sport_text_input(
    message: Message,
    state: FSMContext,
    store: GoogleSheetsStore | None,
) -> None:
    data = await state.get_data()
    step = data.get("sport_step")
    if not step:
        await state.clear()
        await message.answer("Сессия сброшена. Нажми /start и начни снова.")
        return

    pending = _pending_dict(data)

    if step in OPTIONAL_MINUTES_STEPS:
        value = parse_sport_number(message.text or "")
        if value is None:
            await message.answer(f"Не понял число.\n\n{SPORT_VALUE_HINT}")
            return
        field = WARMUP_FIELD if step == WARMUP_STEP else STRETCH_FIELD
        pending[field.col_1based] = value
        await state.update_data(sport_pending=_pending_to_state(pending))
        await _send_step(state, _next_after_optional_minutes(step), message)
        return

    if step not in FIELD_STEP_TO_FIELD:
        await message.answer("Сейчас жду ответ кнопкой. Или нажми «Отмена».")
        return

    field = FIELD_STEP_TO_FIELD[step]

    value = parse_sport_number(message.text or "")
    if value is None:
        await message.answer(f"Не понял число.\n\n{SPORT_VALUE_HINT}")
        return
    pending[field.col_1based] = value
    if step == "running_time":
        apply_computed_pace(pending)

    await state.update_data(sport_pending=_pending_to_state(pending))

    if step == _last_field_of_block("running"):
        await _finish_sport_session(message, state, store)
        return

    await _advance_from_step(message, state, step, store)


async def _finish_sport_session(
    message: Message,
    state: FSMContext,
    store: GoogleSheetsStore | None,
) -> None:
    session = await _session_day_row(state)
    if session is None:
        await state.clear()
        await message.answer("Сессия сброшена. Нажми /start и начни снова.")
        return

    day, row_1based = session
    pending = _pending_dict(await state.get_data())
    apply_computed_pace(pending)
    label = full_label(day)

    if not pending:
        await state.clear()
        await send_welcome(message)
        return

    if store is None:
        await state.clear()
        await message.answer(
            "Таблица не подключена. Проверь SHEETS_API_URL в .env.",
        )
        return

    saving = await message.answer("Сохраняю в таблицу…")
    cells = [
        {"col1Based": col, "value": val} for col, val in sorted(pending.items())
    ]
    try:
        await store.write_sport_batch(day, cells, row_1based)
    except SheetsError as exc:
        await state.clear()
        await saving.delete()
        await message.answer(message_for_sheets_error(exc, day))
        return
    await saving.delete()

    if is_sunday(day):
        rendered_path: str | None = None
        try:
            month_payload = await store.get_month_sport(day)
            rendered_path = await render_sport_image(month_payload)
            await message.answer_photo(
                FSInputFile(rendered_path),
                caption="Sport by min + Sport by type",
            )
        except Exception:
            # Chart preview is best-effort and should not block flow.
            pass
        finally:
            if rendered_path:
                cleanup_rendered_image(rendered_path)

    await message.answer(
        kbju_reminder_text(pending),
        parse_mode=KBJU_PARSE_MODE,
    )
    await state.clear()
    await send_welcome(message)


async def cancel_sport(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    await state.clear()
    if callback.message:
        await send_welcome(callback.message)
