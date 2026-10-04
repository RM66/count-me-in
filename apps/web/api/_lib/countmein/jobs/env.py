"""Configuration the job handlers need, read per delivery — the receiver
is a serverless function, so "startup" is every request. A missing
variable must fail the delivery loudly (500 → QStash retries), not
silently skip."""

from __future__ import annotations

import os
from dataclasses import dataclass

from .. import logx


@dataclass(frozen=True)
class Env:
    telegram_bot_token: str
    # Public origin used to build every link in a message (no trailing slash).
    app_url: str


def read_env() -> Env:
    telegram_bot_token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    app_url = os.getenv("APP_URL", "").strip().rstrip("/")
    if telegram_bot_token == "":
        logx.info("TELEGRAM_BOT_TOKEN is not set", None)
    if app_url == "":
        logx.info("APP_URL is not set", None)
    if telegram_bot_token == "" or app_url == "":
        raise RuntimeError("jobs env is not configured (TELEGRAM_BOT_TOKEN / APP_URL)")
    return Env(telegram_bot_token=telegram_bot_token, app_url=app_url)
