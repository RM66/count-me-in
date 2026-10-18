"""Environment validation for the API.

A missing AUTH_SECRET used to degrade silently into "every organizer is
anonymous" with a single log line — a production misconfiguration looked
like a login bug. validate() makes it a hard startup error instead.
"""

import os
from urllib.parse import unquote, urlsplit

# Required in production (or under STRICT_ENV=1). QSTASH_NEXT_SIGNING_KEY
# is deliberately absent — rotation-only. Realtime (ADR-025) is required
# too but has no name here: validate() checks realtime_credentials()
# resolves (REDIS_REST_URL or an Upstash-shaped REDIS_URL).
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


def _rest_url_credentials(value: str) -> tuple[str, str] | None:
    """Parse ``scheme://[:user]:token@host[:port]`` → (base, token).

    The token rides in userinfo (password, else bare username), so one
    variable carries endpoint and credential.
    """
    try:
        parts = urlsplit(value)
        port = parts.port  # property access raises on a malformed port
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    token = unquote(parts.password or parts.username or "")
    if not token:
        return None
    # urlsplit strips IPv6 brackets on .hostname; restore them so the
    # origin matches WHATWG URL.origin on the TS side.
    host = f"[{parts.hostname}]" if ":" in parts.hostname else parts.hostname
    base = f"{parts.scheme}://{host}"
    # WHATWG URL.origin semantics: an explicit default port folds away.
    if port and port != (443 if parts.scheme == "https" else 80):
        base += f":{port}"
    return base, token


def realtime_credentials() -> tuple[str, str] | None:
    """(base URL, token) for the realtime REST endpoint, else None.
    Validation-only here — Next.js emits/subscribes (ADR-025), but the
    shared env makes this cold-start check the deploy's realtime guard.

    Sources, in order: ``REDIS_REST_URL`` (token in userinfo — also how
    non-Upstash targets like the compose up-redis emulator are
    addressed), then an Upstash-shaped ``REDIS_URL``
    (``redis(s)://…:token@*.upstash.io`` → ``https://host`` + password).

    Mirrored by ``realtimeRestConfig()`` in
    ``src/server/realtime-config.ts`` — keep them in sync. Production
    validate() refuses a missing resolution; elsewhere None means "off".
    """
    rest = os.getenv("REDIS_REST_URL", "").strip()
    if rest:
        return _rest_url_credentials(rest)
    try:
        parts = urlsplit(os.getenv("REDIS_URL", "").strip())
    except ValueError:
        return None
    host = parts.hostname or ""
    if parts.scheme in ("redis", "rediss") and host.endswith(".upstash.io") and parts.password:
        return f"https://{host}", unquote(parts.password)
    return None


class ConfigError(Exception):
    """The environment the API needs is missing or malformed."""


def validate() -> None:
    """Check the environment the API needs; called at app construction.
    Raises ConfigError on failure.

    Production-only (STRICT_ENV=1 opts in elsewhere): dev secrets are
    routinely absent, and lazy per-module errors still surface them at
    first use.
    """
    if not is_production() and os.getenv("STRICT_ENV") != "1":
        return
    problems: list[str] = []
    missing = [name for name in _REQUIRED if os.getenv(name, "").strip() == ""]
    if missing:
        problems.append("missing required environment variables: " + ", ".join(missing))

    # Realtime (ADR-025): Next.js owns emit/subscribe but shares the
    # env — an unresolvable pair must fail the cold start, not drop
    # every occupancy event silently past health checks.
    if realtime_credentials() is None:
        problems.append(
            "missing realtime credentials: set REDIS_REST_URL "
            "(http(s)://:token@host[:port]) or use an Upstash REDIS_URL "
            "(redis(s)://…:token@*.upstash.io)"
        )

    # APP_URL feeds the QStash publish URL and notification links;
    # INTERNAL_APP_URL (optional server-to-server origin for the
    # revalidate/occupancy hop) gets the same scheme+host-only rule —
    # a typo must fail, not degrade into silent fallback.
    for name in ("APP_URL", "INTERNAL_APP_URL"):
        raw = os.getenv(name, "")
        if raw == "" and name != "APP_URL":
            continue
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
            problems.append(
                f"{name} must be an absolute http(s) URL without a path, "
                f"query or fragment, got {raw!r}"
            )
    # Report every problem at once — not one per redeploy.
    if problems:
        raise ConfigError("; ".join(problems))
