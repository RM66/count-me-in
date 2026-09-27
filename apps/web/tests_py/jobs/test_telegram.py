"""The Telegram error-classification tests — the retry budget
(ADR-012). The fake Bot API is an async transport seam instead of an
httptest server."""

import json

import _lib.countmein.jobs.telegram as telegram
import httpx
import pytest
from _lib.countmein.jobs.telegram import (
    SendMessageError,
    TelegramTerminalError,
    TelegramTransientError,
    TelegramUnreachableError,
)


class FakeTelegram:
    def __init__(self):
        self.calls: list[dict] = []
        self.status = 0
        self.desc = ""

    async def __call__(self, url, content=None, headers=None, **kwargs):
        body = json.loads(content or b"{}")
        markup = body.get("reply_markup")
        button = ""
        if markup and markup.get("inline_keyboard"):
            button = markup["inline_keyboard"][0][0].get("url", "")
        self.calls.append(
            {"chat_id": body.get("chat_id"), "text": body.get("text"), "button": button}
        )
        if self.status == 0:
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(
            self.status, json={"ok": False, "description": self.desc, "error_code": self.status}
        )


@pytest.fixture()
def fake(monkeypatch):
    ft = FakeTelegram()
    monkeypatch.setattr(telegram, "_post", ft)
    yield ft
    telegram._reset_for_test()


async def test_send_message_unreachable_is_terminal(fake):
    # 403 — the recipient never pressed Start.
    fake.status, fake.desc = 403, "Forbidden: bot was blocked by the user"
    with pytest.raises(TelegramUnreachableError):
        await telegram.send_message("tok", "chat-1", "hi")

    # 400 "chat not found" — same event for the receiver.
    fake.status, fake.desc = 400, "Bad Request: chat not found"
    with pytest.raises(TelegramUnreachableError):
        await telegram.send_message("tok", "chat-1", "hi")

    # A content-rejected 400 (our escaping bug, or an over-long message)
    # is terminal: retrying cannot fix the payload, so the job completes
    # with a log instead of burning the retry budget.
    fake.status, fake.desc = 400, "Bad Request: can't parse entities"
    with pytest.raises(TelegramTerminalError):
        await telegram.send_message("tok", "chat-1", "hi")

    fake.status, fake.desc = 400, "Bad Request: message is too long"
    with pytest.raises(TelegramTerminalError):
        await telegram.send_message("tok", "chat-1", "hi")

    # Any other 400 stays a plain error — never silently completed.
    fake.status, fake.desc = 400, "Bad Request: something unexpected"
    with pytest.raises(SendMessageError):
        await telegram.send_message("tok", "chat-1", "hi")


async def test_send_message_transient_is_retryable(fake):
    # 429 — rate limit, worth retrying.
    fake.status, fake.desc = 429, "Too Many Requests: retry after 5"
    with pytest.raises(TelegramTransientError):
        await telegram.send_message("tok", "chat-1", "hi")

    # 5xx — outage, worth retrying.
    fake.status, fake.desc = 500, "Internal Server Error"
    with pytest.raises(TelegramTransientError):
        await telegram.send_message("tok", "chat-1", "hi")


async def test_send_message_success_records_call(fake):
    await telegram.send_message(
        "tok",
        "chat-9",
        "hi",
        telegram.MessageButton(text="Open", url="https://example.com"),
    )
    assert fake.calls == [
        {
            "chat_id": "chat-9",
            "text": "hi",
            "button": "https://example.com",
        }
    ]
