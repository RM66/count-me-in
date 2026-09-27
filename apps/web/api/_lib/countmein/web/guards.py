"""Request-level guards: who is allowed to write in this request.

Guards raise instead of returning (value, response) tuples:
DemoReadOnly / RateLimited / TicketExpired / PayloadTooLarge propagate
to the app-level ApiError handler, which renders the same
bodies the tuple plumbing used to.
"""

from __future__ import annotations

import math

from starlette.requests import Request

from .. import logx
from ..auth import session as auth_session
from ..auth.telegram import TICKET_PURPOSE_GUEST
from ..auth.ticket import consume_ticket
from ..contracts.payloads import AuthTicketPayload
from ..demo import is_read_only
from ..errors import DemoReadOnly, PayloadTooLarge, RateLimited, TicketExpired
from .ratelimit import RateLimitConfig, allow, client_ip

# Every organizer write also passes a per-organizer rate bucket: the
# cabinet CRUD routes had no limits at all, so a runaway client could
# hammer the API unthrottled. The bucket is keyed by organizer id — a
# signed-in organizer is already authenticated, so this is abuse
# protection, not auth. The bucket is consulted *before* the demo
# refusal: anonymous and demo callers are refused with a cheap 403, and
# without the limiter that refusal would be hammerable for free
# (anonymous callers bucket by IP, since they share no id).
#
# Reads are deliberately unmetered here — read limiting is delegated to
# the edge (Vercel), which absorbs anonymous scraping before it reaches
# the function.
_ORGANIZER_WRITE_LIMIT = RateLimitConfig(limit=60, window=60.0)


async def require_writable_organizer(request: Request) -> str:
    """Who is allowed to *write* in this request. Anonymous callers are
    demo-cabinet visitors (/cabinet needs no session, ADR-010), so they
    get the same DEMO_READ_ONLY refusal as the demo id itself rather
    than a bare 401. The policy lives in demo/; this is its
    request-level door. Returns the organizer id when the caller may
    proceed."""
    organizer_id = auth_session.session_organizer_id(request)
    if organizer_id == "":
        bucket = "rl:organizer-write:anon:" + client_ip(request)
    else:
        bucket = "rl:organizer-write:" + organizer_id
    allowed, retry_after = await allow(bucket, _ORGANIZER_WRITE_LIMIT)
    if not allowed:
        raise RateLimited(math.ceil(retry_after))
    if is_read_only(organizer_id):
        raise DemoReadOnly()
    return organizer_id


async def require_guest_identity(request: Request, ticket: str) -> AuthTicketPayload:
    """Redeem a guest auth ticket for the messenger identity behind it —
    the guest counterpart of require_writable_organizer. The ticket is
    consumed (GETDEL), not peeked: single-use, so a replayed request
    finds nothing and is refused. The only way a guest identity may enter
    a write: invariant 8 says it comes from a server-validated widget
    payload, never from raw client input."""
    try:
        payload = await consume_ticket(ticket)
    except Exception as err:
        # Identity is NOT fail-open (ADR-019): a Redis outage is a 500.
        # Logged here (with scope) because the recovery middleware sees
        # only a bare RuntimeError.
        logx.error(err, {"scope": "consume-ticket"})
        raise RuntimeError("ticket consumption failed") from err
    # Purpose claim: a ticket minted for organizer registration must not
    # be redeemable in the booking flow. Answered like an expired one —
    # the caller cannot distinguish "wrong flow" from "unknown ticket".
    if payload is None or payload.purpose != TICKET_PURPOSE_GUEST:
        raise TicketExpired()
    return payload


async def read_body_or_413(request: Request) -> bytes:
    """Read the raw request body, bounded at 1MB, and answer 413 when
    the body exceeds the bound. A truncated body would otherwise surface
    as a confusing 400 "invalid JSON" instead of the honest size
    refusal.

    The body is read incrementally and refused as soon as the bound is
    crossed — a 2GB upload must not be buffered first. Content-Length
    is honored early when present (a lying header still gets caught by
    the incremental read)."""
    max_body = 1 << 20

    content_length = request.headers.get("content-length", "")
    if content_length != "":
        try:
            if int(content_length) > max_body:
                raise PayloadTooLarge()
        except ValueError:
            pass  # malformed header — the incremental read decides

    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > max_body:
            raise PayloadTooLarge()
        chunks.append(chunk)
    return b"".join(chunks)
