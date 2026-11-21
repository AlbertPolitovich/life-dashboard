from aiogram.fsm.state import State, StatesGroup


class FillForm(StatesGroup):
    waiting_for_date = State()
    choosing_track = State()
    filling_routine = State()
    offer_sport_after_routine = State()
    filling_sport = State()
    configuring_notifications = State()
    waiting_for_notification_time = State()
