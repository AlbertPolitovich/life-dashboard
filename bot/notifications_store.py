import json
from dataclasses import asdict, dataclass
from pathlib import Path

SETTINGS_PATH = Path(__file__).parent / "notification_settings.json"


@dataclass
class NotificationSettings:
    enabled: bool = False
    hour: int = 8
    minute: int = 0
    chat_id: int = 0
    last_sent_date: str = ""


def _load_all() -> dict[str, dict]:
    if not SETTINGS_PATH.exists():
        return {}
    try:
        return json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _save_all(data: dict[str, dict]) -> None:
    SETTINGS_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def get_settings(user_id: int) -> NotificationSettings:
    raw = _load_all().get(str(user_id))
    if not raw:
        return NotificationSettings()
    return NotificationSettings(
        enabled=bool(raw.get("enabled", False)),
        hour=int(raw.get("hour", 8)),
        minute=int(raw.get("minute", 0)),
        chat_id=int(raw.get("chat_id", 0)),
        last_sent_date=str(raw.get("last_sent_date", "")),
    )


def save_settings(user_id: int, settings: NotificationSettings) -> None:
    data = _load_all()
    data[str(user_id)] = asdict(settings)
    _save_all(data)


def iter_enabled_for_reminder() -> list[tuple[int, NotificationSettings]]:
    result: list[tuple[int, NotificationSettings]] = []
    for user_id_str, raw in _load_all().items():
        settings = NotificationSettings(
            enabled=bool(raw.get("enabled", False)),
            hour=int(raw.get("hour", 8)),
            minute=int(raw.get("minute", 0)),
            chat_id=int(raw.get("chat_id", 0)),
            last_sent_date=str(raw.get("last_sent_date", "")),
        )
        if settings.enabled and settings.chat_id:
            result.append((int(user_id_str), settings))
    return result
