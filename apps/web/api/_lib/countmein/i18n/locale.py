"""Locale resolution, the way next-intl does on the server (ADR-011):
cookie NEXT_LOCALE → Accept-Language → default."""

from __future__ import annotations

from collections.abc import Mapping

from ..contracts.constants_gen import DEFAULT_LOCALE
from ..contracts.domain import is_app_locale, match_locale


def detect_locale(cookies: Mapping[str, str], accept_language: str) -> str:
    cookie = cookies.get("NEXT_LOCALE", "")
    if cookie and is_app_locale(cookie):
        return cookie
    locale = match_locale(accept_language)
    if locale is not None:
        return locale
    return DEFAULT_LOCALE
