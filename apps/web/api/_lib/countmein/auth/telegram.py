"""Server-side validation of a Telegram Login Widget payload (ADR-008).

The payload is attacker-controlled until the HMAC has been verified
against the bot token; only the identity returned here may be
persisted. Port of @telegram-auth/server's AuthDataValidator.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass
from typing import Any

from ..contracts.models import unwrap_root
from ..contracts.payloads import AuthTicketPayload
from ..errors import ValidationFailed
from ..validation.decode import decode_telegram_widget_payload


class TelegramNotConfiguredError(Exception):
    def __init__(self) -> None:
        super().__init__("TELEGRAM_BOT_TOKEN is not set")


class TelegramInvalidError(Exception):
    def __init__(self) -> None:
        super().__init__("telegram auth data is malformed")


class TelegramValidationFailedError(Exception):
    def __init__(self) -> None:
        super().__init__("telegram auth data failed HMAC validation")


@dataclass
class TelegramIdentity:
    """A validated Telegram identity mapped onto the fields the app
    speaks (messenger + messengerId, ADR-008) rather than Telegram's own
    snake_case shape."""

    messenger: str
    messenger_id: str
    display_name: str
    photo_url: str | None = None
    messenger_login: str | None = None

    def to_ticket_payload(self, purpose: str) -> AuthTicketPayload:
        """`purpose` binds the ticket to one flow — the caller decides
        which flow, the payload carries it, and the consuming guard
        rejects a ticket minted for the other flow."""
        return AuthTicketPayload(
            messenger=self.messenger,
            messenger_id=self.messenger_id,
            display_name=self.display_name,
            photo_url=self.photo_url,
            messenger_login=self.messenger_login,
            purpose=purpose,
        )


# Ticket purposes: a ticket minted for one flow must not be redeemable
# in another.
TICKET_PURPOSE_GUEST = "guest"
TICKET_PURPOSE_ORGANIZER = "organizer"

# Mirrors @telegram-auth/server's inValidateDataAfter default: a widget
# payload older than 24 hours is expired. Without this, a captured widget
# body (browser history, access logs, a leaked request) could be replayed
# forever to mint fresh single-use tickets for that identity.
WIDGET_DATA_VALID_AFTER = 86400

# How far in the future auth_date may lie. The past window is a generous
# 24h (a guest may take a while between opening the widget and
# completing signup), but the future direction gets only clock skew:
# Telegram signs the current time, so auth_date an hour ahead is a
# forged or replayed claim, not a slow clock.
WIDGET_FUTURE_SKEW = 300


def _scalar_string(v: Any) -> str | None:
    """Render a widget value for the data-check-string: strings as-is,
    numbers via their literal (objectToAuthDataMap)."""
    if isinstance(v, str):
        return v
    if isinstance(v, int):
        return str(v)
    return None


def _nil_if_empty(s: str | None) -> str | None:
    if s is None or s == "":
        return None
    return s


def validate_telegram_widget(body: bytes) -> TelegramIdentity:
    """Shape-check and HMAC-verify a widget body. Raises
    TelegramNotConfiguredError (500 at the route), TelegramInvalidError
    (400 telegramInvalid) for malformed payloads, or
    TelegramValidationFailedError (400 telegramValidationFailed) for a
    signature mismatch or an expired auth_date."""
    bot_token = os.getenv("TELEGRAM_BOT_TOKEN", "")
    if bot_token == "":
        raise TelegramNotConfiguredError()

    try:
        payload = decode_telegram_widget_payload(body)
    except ValidationFailed:
        raise TelegramInvalidError() from None

    # The data-check-string covers every field the widget sent, including
    # any the schema does not model — it is computed from the raw body,
    # never from the parsed struct. parse_float/parse_int keep numeric
    # literals as their on-the-wire scalars.
    try:
        # parse_int=int: a JSON integer's literal is str(int) exactly
        # (JSON forbids leading zeros), so the data-check-string keeps
        # its on-the-wire shape. Floats stay literals.
        raw = json.loads(body, parse_float=lambda x: x, parse_int=int)
    except ValueError:
        raise TelegramInvalidError() from None
    if not isinstance(raw, dict):
        raise TelegramInvalidError()
    # The retired implementation's decode rejects a string for an integer
    # field; Pydantic's lax mode would coerce it. Enforce the wire types
    # here so "string id"/"string date" stay TelegramInvalidError.
    if not isinstance(raw.get("id"), int) or isinstance(raw.get("id"), bool):
        raise TelegramInvalidError()
    if not isinstance(raw.get("auth_date"), int) or isinstance(raw.get("auth_date"), bool):
        raise TelegramInvalidError()

    keys = sorted(k for k in raw if k != "hash")
    pairs = []
    for k in keys:
        s = _scalar_string(raw[k])
        if s is None:
            raise TelegramInvalidError()
        pairs.append(f"{k}={s}")
    dcs = "\n".join(pairs)

    # secret = SHA256(bot_token); hash = HMAC-SHA256(secret, dcs) hex.
    secret = hashlib.sha256(bot_token.encode()).digest()
    expected = hmac.new(secret, dcs.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, unwrap_root(payload.hash)):
        raise TelegramValidationFailedError()

    # Freshness (hasDataExpired in the TS validator): the HMAC proves
    # the payload came from Telegram, not that it was sent recently.
    # Asymmetric: stale payloads are rejected past 24h, future ones past
    # clock skew — a future auth_date is a forged claim, not a slow
    # guest.
    age = int(time.time()) - int(unwrap_root(payload.auth_date))
    if age > WIDGET_DATA_VALID_AFTER or age < -WIDGET_FUTURE_SKEW:
        raise TelegramValidationFailedError()

    first = unwrap_root(payload.first_name).strip()
    last = (unwrap_root(payload.last_name) or "").strip()
    identity = TelegramIdentity(
        messenger="telegram",
        messenger_id=str(int(unwrap_root(payload.id))),
        display_name=f"{first} {last}".strip(),
        photo_url=_nil_if_empty(unwrap_root(payload.photo_url)),
    )
    username = unwrap_root(payload.username)
    if username:
        identity.messenger_login = "@" + username
    return identity
