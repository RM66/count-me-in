"""Short-lived auth tickets (ADR-008): issued after server-side HMAC
validation of the Telegram Login Widget payload; single-use (a replayed
booking fails), 10-minute TTL. Key: auth:ticket:{token}.
"""

from __future__ import annotations

import base64
import json
import secrets
from datetime import timedelta
from typing import Any

from .. import redis as redis_mod
from ..contracts.constants_gen import AUTH_TICKET_TTL_SECONDS
from ..contracts.domain import auth_ticket_key as ticket_key
from ..contracts.payloads import AuthTicketPayload, LoginLinkPayload

TICKET_TTL = timedelta(seconds=AUTH_TICKET_TTL_SECONDS)
_TICKET_BYTES = 32


def new_secret_token() -> str:
    """A 32-byte base64url token (43 chars) — unguessable, never typed
    by hand."""
    return base64.urlsafe_b64encode(secrets.token_bytes(_TICKET_BYTES)).rstrip(b"=").decode()


async def issue_ticket(payload: AuthTicketPayload) -> str:
    """Store the identity behind a fresh one-shot token."""
    token = new_secret_token()
    await redis_mod.client().set(
        ticket_key(token), json.dumps(payload.to_json()), ex=int(TICKET_TTL.total_seconds())
    )
    return token


def _parse_ticket(raw: Any) -> AuthTicketPayload | None:
    """Map "no payload usable" to None; a Redis failure propagates as an
    exception from the caller's await."""
    if raw is None:
        return None
    try:
        return AuthTicketPayload.from_json(json.loads(raw))
    except (ValueError, KeyError):
        return None


async def peek_ticket(token: str) -> AuthTicketPayload | None:
    """Read a ticket without consuming it — the registration form is in
    flight and the Auth.js sign-in still needs the ticket."""
    raw = await redis_mod.client().get(ticket_key(token))
    return _parse_ticket(raw)


async def consume_ticket(token: str) -> AuthTicketPayload | None:
    """Atomically read and delete a ticket (GETDEL) — what makes it
    single-use: concurrent redemptions race on one Redis command and
    only the winner gets the payload."""
    raw = await redis_mod.client().getdel(ticket_key(token))
    return _parse_ticket(raw)


async def consume_guest_ticket(token: str) -> AuthTicketPayload:
    """Redeem a *guest-purpose* ticket: consume it and answer the
    identity, or raise TicketExpired. The only place a guest ticket is
    spent — guards.py (booking lookup) and create_guest_booking (after
    the domain refusals, ADR-024 B1) — so purpose check and failure
    semantics cannot drift.

    A wrong-purpose ticket answers like an expired one — the caller
    cannot distinguish "wrong flow" from "unknown"."""
    from .. import logx
    from ..errors import TicketExpired
    from .telegram import TICKET_PURPOSE_GUEST

    try:
        payload = await consume_ticket(token)
    except Exception as err:
        # Identity is NOT fail-open (ADR-019): a Redis outage is a 500.
        # Logged here because the recovery middleware sees only a bare
        # RuntimeError.
        logx.error(err, {"scope": "consume-ticket"})
        raise RuntimeError("ticket consumption failed") from err
    if payload is None or payload.purpose != TICKET_PURPOSE_GUEST:
        raise TicketExpired()
    return payload


# ── One-time login links ─────────────────────────────────────────────────────
# Notifications deep-link into the cabinet, but /cabinet needs no
# session — without one the organizer lands in the read-only demo
# cabinet (ADR-010). Minted per send attempt; a retry mints a fresh
# token and the abandoned one expires.

from ..contracts.constants_gen import LOGIN_LINK_TTL_SECONDS  # noqa: E402
from ..contracts.domain import login_link_key  # noqa: E402


async def issue_login_link(organizer_id: str, next: str) -> str:
    """Store {organizerId, next} behind a fresh token."""
    token = new_secret_token()
    payload = LoginLinkPayload(organizer_id=organizer_id, next=next)
    await redis_mod.client().set(
        login_link_key(token), json.dumps(payload.to_json()), ex=LOGIN_LINK_TTL_SECONDS
    )
    return token


def _is_safe_next_path(next: str) -> bool:
    """A relative cabinet path only: starts with "/" but not "//"
    (scheme-relative) or "/\\" (browsers normalize to protocol-relative).
    Backslashes and control chars are rejected anywhere — "\\foo" reads
    as "/foo" and CR/LF/NUL can split downstream responses."""
    if not next or next[0] != "/":
        return False
    if next.startswith("//") or next.startswith("/\\"):
        return False
    for c in next:
        if c == "\\" or ord(c) < 0x20 or ord(c) == 0x7F:
            return False
    return True


def _parse_login_link(raw: Any) -> LoginLinkPayload | None:
    if raw is None:
        return None
    try:
        payload = LoginLinkPayload.from_json(json.loads(raw))
    except (ValueError, KeyError):
        return None
    # `next` must be a relative path (open-redirect guard, mirrored from
    # the loginLinkPayload schema).
    if payload.organizer_id == "" or not _is_safe_next_path(payload.next):
        return None
    return payload


async def peek_login_link(token: str) -> LoginLinkPayload | None:
    """Read without consuming — the landing page must inspect a token
    without spending it; link previewers fetch URLs before humans do."""
    raw = await redis_mod.client().get(login_link_key(token))
    return _parse_login_link(raw)


async def consume_login_link(token: str) -> LoginLinkPayload | None:
    """Atomically read and delete (GETDEL): single-use — a replayed POST
    cannot mint a second session."""
    raw = await redis_mod.client().getdel(login_link_key(token))
    return _parse_login_link(raw)
