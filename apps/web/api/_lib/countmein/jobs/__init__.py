"""Job handlers — the consumer side of the QStash pipeline (ADR-012).

Submodules follow one file per concern:
- receiver: QStash signature verification (Receiver port)
- run: dispatch, payload validation, consumer idempotency
- telegram: Bot API client + error classification
- templates: notification rendering (Telegram HTML)
- links: every URL that appears in a notification
- env: per-delivery configuration
- booking_created / booking_cancelled / demo_refresh / outbox_sweep: handlers
"""

from .env import Env, read_env
from .links import (
    cabinet_slot_path,
    login_link_url,
    manage_booking_url,
    organizer_page_url,
)
from .receiver import trace_id_from_headers, verify_qstash_signature
from .run import (
    InvalidJobPayloadError,
    UnknownJobQueueError,
    parse_job,
    run_job,
)
from .telegram import (
    MessageButton,
    SendMessageError,
    TelegramTerminalError,
    TelegramTransientError,
    TelegramUnreachableError,
    send_message,
)

__all__ = [
    "Env",
    "InvalidJobPayloadError",
    "MessageButton",
    "SendMessageError",
    "TelegramTerminalError",
    "TelegramTransientError",
    "TelegramUnreachableError",
    "UnknownJobQueueError",
    "cabinet_slot_path",
    "login_link_url",
    "manage_booking_url",
    "organizer_page_url",
    "parse_job",
    "read_env",
    "run_job",
    "send_message",
    "trace_id_from_headers",
    "verify_qstash_signature",
]
