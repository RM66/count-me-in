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

from ..contracts.payloads import AuthTicketPayload
from ..errors import (
    TelegramInvalidError,
    TelegramNotConfiguredError,
    TelegramValidationFailedError,
    ValidationFailed,
)
from ..validation.decode import decode_telegram_widget_payload


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
        """`purpose` binds the ticket to one flow — the consuming guard
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
# payload older than 24h is expired — a captured body must not mint
# fresh tickets forever.
WIDGET_DATA_VALID_AFTER = 86400

# How far in the future auth_date may lie: only clock skew. Telegram
# signs the current time, so a future auth_date is a forged claim.
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
    TelegramNotConfiguredError (500), TelegramInvalidError (400
    telegramInvalid) for malformed payloads, or
    TelegramValidationFailedError (400 telegramValidationFailed) for a
    signature mismatch or expired auth_date."""
    bot_token = os.getenv("TELEGRAM_BOT_TOKEN", "")
    if bot_token == "":
        raise TelegramNotConfiguredError()

    try:
        payload = decode_telegram_widget_payload(body)
    except ValidationFailed:
        raise TelegramInvalidError() from None

    # The data-check-string covers every field the widget sent, including
    # ones the schema doesn't model — computed from the raw body, never
    # the parsed struct. parse_int=int keeps a JSON integer's literal
    # (str(int)); floats stay literals.
    try:
        raw = json.loads(body, parse_float=lambda x: x, parse_int=int)
    except ValueError:
        raise TelegramInvalidError() from None
    if not isinstance(raw, dict):
        raise TelegramInvalidError()
    # Enforce wire types the old decoder required — Pydantic's lax mode
    # would coerce a "string id"/"string date" that must stay invalid.
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
    if not hmac.compare_digest(expected, payload.hash):
        raise TelegramValidationFailedError()

    # Freshness (hasDataExpired in the TS validator): the HMAC proves
    # origin, not recency. Asymmetric — stale past 24h, future past
    # clock skew.
    age = int(time.time()) - int(payload.auth_date)
    if age > WIDGET_DATA_VALID_AFTER or age < -WIDGET_FUTURE_SKEW:
        raise TelegramValidationFailedError()

    first = payload.first_name.strip()
    last = (payload.last_name or "").strip()
    identity = TelegramIdentity(
        messenger="telegram",
        messenger_id=str(int(payload.id)),
        display_name=f"{first} {last}".strip(),
        photo_url=_nil_if_empty(str(payload.photo_url) if payload.photo_url else None),
    )
    username = payload.username
    if username:
        identity.messenger_login = "@" + username
    return identity
