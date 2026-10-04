"""Telegram Bot API client — just sendMessage, over httpx. No SDK: one
endpoint, one method, and a dependency here would be more code to audit
than the request it replaces.

The interesting part is the error classification. A notification job
that retries everything is worse than one that retries nothing: the
single most common failure is a recipient who never pressed Start on the
bot (a bot may only message users who did), and that never becomes
deliverable no matter how many times it is tried."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

import httpx

from ..web.async_client import client as async_client

# MessageButton is a link rendered as a tappable button under the message.


@dataclass(frozen=True)
class MessageButton:
    text: str
    url: str


class TelegramUnreachableError(Exception):
    """Not worth retrying. Covers "never started the bot" (403) and
    "chat not found" (400) — the same event: the recipient cannot be
    messaged, and the job is done as well as it ever will be."""

    def __init__(self, chat_id: str, description: str):
        super().__init__(f"Telegram cannot reach chat {chat_id}: {description}")
        self.chat_id = chat_id
        self.description = description


class TelegramTerminalError(Exception):
    """The message content itself was rejected (too long, malformed
    HTML). Retrying cannot fix the payload, so the job completes with a
    log instead of burning the retry budget."""

    def __init__(self, description: str):
        super().__init__("Telegram rejected the message content: " + description)
        self.description = description


class TelegramTransientError(Exception):
    """Rate limit, outage, network. The job retries."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class SendMessageError(Exception):
    """Any other rejection — surfaced for the route to answer 500 with
    (which is what makes QStash retry)."""


_CHAT_NOT_FOUND_RE = re.compile(r"chat not found", re.IGNORECASE)
# Bot API descriptions for rejections caused by the message itself
# rather than the recipient or the network.
_TERMINAL_CONTENT_RE = re.compile(
    r"(message is too long|can't parse entities|can't parse buttons)", re.IGNORECASE
)

_HTTP_TIMEOUT = 10.0
_TELEGRAM_API_BASE = "https://api.telegram.org"


async def send_message(
    bot_token: str,
    chat_id: str,
    text: str,
    button: MessageButton | None = None,
) -> None:
    """Send one message. link_preview_options.is_disabled keeps Telegram
    from unfurling the URL — a preview card for a page needing the
    recipient's credentials, and for the one-time login link a preview
    fetch is the robot request POST-to-consume exists to defeat."""
    body: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "link_preview_options": {"is_disabled": True},
    }
    if button is not None:
        body["reply_markup"] = {
            "inline_keyboard": [[{"text": button.text, "url": button.url}]],
        }
    raw = json.dumps(body)

    try:
        res = await async_client().post(
            _TELEGRAM_API_BASE + "/bot" + bot_token + "/sendMessage",
            content=raw,
            headers={"Content-Type": "application/json"},
            timeout=_HTTP_TIMEOUT,
        )
    except httpx.HTTPError as err:
        raise TelegramTransientError(f"Telegram request failed: {err}") from err

    try:
        payload = res.json()
    except ValueError:
        payload = {}

    if 200 <= res.status_code < 300 and payload.get("ok") is True:
        return

    description = payload.get("description") or f"HTTP {res.status_code}"

    if res.status_code == 403 or (
        res.status_code == 400 and _CHAT_NOT_FOUND_RE.search(description)
    ):
        raise TelegramUnreachableError(chat_id, description)
    if res.status_code == 429 or res.status_code >= 500:
        raise TelegramTransientError(f"Telegram {res.status_code}: {description}")
    if 400 <= res.status_code < 500 and _TERMINAL_CONTENT_RE.search(description):
        raise TelegramTerminalError(description)
    raise SendMessageError(f"Telegram rejected the message ({res.status_code}): {description}")
