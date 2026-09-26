"""Auth: Telegram widget validation, single-use tickets, one-time login
links, and organizer session resolution."""

from .session import Session, session_from_request, session_organizer_id
from .telegram import (
    TelegramIdentity,
    TelegramInvalidError,
    TelegramNotConfiguredError,
    TelegramValidationFailedError,
    validate_telegram_widget,
)
from .ticket import (
    consume_login_link,
    consume_ticket,
    issue_login_link,
    issue_ticket,
    peek_login_link,
    peek_ticket,
)

__all__ = [
    "Session",
    "TelegramIdentity",
    "TelegramInvalidError",
    "TelegramNotConfiguredError",
    "TelegramValidationFailedError",
    "consume_login_link",
    "consume_ticket",
    "issue_login_link",
    "issue_ticket",
    "peek_login_link",
    "peek_ticket",
    "session_from_request",
    "session_organizer_id",
    "validate_telegram_widget",
]
