"""Auth: Telegram widget validation, single-use tickets, one-time login
links, and organizer session resolution."""

from ..errors import (
    TelegramInvalidError,
    TelegramNotConfiguredError,
    TelegramValidationFailedError,
)
from .session import Session, session_from_request
from .telegram import TelegramIdentity, validate_telegram_widget
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
    "validate_telegram_widget",
]
