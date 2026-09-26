"""Translation lookup over the generated corpus.

The API only needs two slices of the full corpus: the ApiErrors
section of the web messages (route error copy) and all notification
copy (Telegram bot). translations_gen.py compiles those slices at
build time — packages/translations remains the single source of truth.
"""

from collections.abc import Mapping
from typing import Any

from ..contracts.constants_gen import DEFAULT_LOCALE
from .format import format_message
from .translations_gen import API_ERRORS, NOTIFICATIONS_SECTIONS, NOTIFICATIONS_TOP


def api_error(locale: str, key: str, params: Mapping[str, Any] | None = None) -> str:
    """Render a localized API error (the ApiErrors section), falling back
    to English, then to the key itself."""
    msg = API_ERRORS.get(locale, {}).get(key)
    if msg is None:
        msg = API_ERRORS.get(DEFAULT_LOCALE, {}).get(key)
        if msg is None:
            return key
        locale = DEFAULT_LOCALE
    return format_message(msg, locale, params or {})


def notif(locale: str, section: str, key: str, params: Mapping[str, Any] | None = None) -> str:
    """Render a notification message. section "" addresses the top-level
    keys ("seats"); otherwise section.key. Falls back to English, then to
    "section.key"."""
    params = params or {}

    def lookup(loc: str) -> str | None:
        if section == "":
            return NOTIFICATIONS_TOP.get(loc, {}).get(key)
        return NOTIFICATIONS_SECTIONS.get(loc, {}).get(section, {}).get(key)

    msg = lookup(locale)
    if msg is None:
        msg = lookup(DEFAULT_LOCALE)
        if msg is None:
            if section == "":
                return key
            return section + "." + key
        locale = DEFAULT_LOCALE
    return format_message(msg, locale, params)
