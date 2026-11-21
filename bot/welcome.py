from pathlib import Path

from aiogram import Bot
from aiogram.types import FSInputFile, Message

from keyboards import start_keyboard

WELCOME_IMAGE = Path(__file__).resolve().parent / "assets" / "welcome.png"


def _welcome_photo() -> FSInputFile:
    return FSInputFile(WELCOME_IMAGE)


async def send_welcome(message: Message) -> None:
    await message.answer_photo(
        _welcome_photo(),
        reply_markup=start_keyboard(),
    )


async def send_welcome_chat(bot: Bot, chat_id: int) -> None:
    await bot.send_photo(
        chat_id,
        _welcome_photo(),
        reply_markup=start_keyboard(),
    )


async def send_reminder(bot: Bot, chat_id: int, *, caption: str) -> None:
    await bot.send_photo(
        chat_id,
        _welcome_photo(),
        caption=caption,
        reply_markup=start_keyboard(),
    )
