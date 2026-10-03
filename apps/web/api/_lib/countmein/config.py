"""Environment validation for the API.

A missing AUTH_SECRET used to degrade silently into "every organizer is
anonymous" with a single log line — a production misconfiguration looked
like a login bug. validate() makes it a hard startup error instead.
"""

import os
from urllib.parse import urlsplit

# Required in production (or under STRICT_ENV=1). QSTASH_NEXT_SIGNING_KEY
# is deliberately NOT required — consulted only during key rotation.
_REQUIRED = [
    "AUTH_SECRET",
    "POSTGRES_URL",
    "REDIS_URL",
    "APP_URL",
    "QSTASH_TOKEN",
    "QSTASH_CURRENT_SIGNING_KEY",
    "TELEGRAM_BOT_TOKEN",
    # Media uploads presign against R2 (ADR-007/024): absent vars used
    # to surface only on the first upload — a deploy missing them passed
    # health checks while every media flow was broken.
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
    "R2_PUBLIC_BASE_URL",
]


def is_production() -> bool:
    """Single source of truth for "is this a production deployment"."""
    return os.getenv("NODE_ENV") == "production" or os.getenv("VERCEL_ENV") == "production"


def redis_configured() -> bool:
    """One shared answer instead of three getenv checks that could drift."""
    return os.getenv("REDIS_URL", "").strip() != ""


class ConfigError(Exception):
    """The environment the API needs is missing or malformed."""


def validate() -> None:
    """Check the environment the API needs; called at app construction.
    Raises ConfigError on failure.

    Production-only: development runs against local services where
    secrets are routinely absent, so validation is skipped — the lazy
    per-module errors still surface them at first use. STRICT_ENV=1
    opts a non-production environment into the same validation.
    """
    if not is_production() and os.getenv("STRICT_ENV") != "1":
        return
    missing = [name for name in _REQUIRED if os.getenv(name, "").strip() == ""]
    if missing:
        raise ConfigError("missing required environment variables: " + ", ".join(missing))

    # APP_URL is concatenated into the QStash publish URL, so a malformed
    # value must fail the cold start. Scheme + host only — a trailing
    # path, query or fragment would silently misroute every publish.
    raw = os.getenv("APP_URL", "")
    value = raw.strip()
    try:
        parts = urlsplit(value)
    except ValueError:
        parts = None
    ok = (
        parts is not None
        and parts.scheme in ("http", "https")
        and parts.netloc != ""
        and parts.path in ("", "/")
        and parts.query == ""
        and parts.fragment == ""
        and "@" not in value.split("//", 1)[-1].split("/", 1)[0]
    )
    if not ok:
        raise ConfigError(
            "APP_URL must be an absolute http(s) URL without a path, "
            f"query or fragment, got {raw!r}"
        )
    return None
