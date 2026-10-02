"""Request-level guards: who is allowed to write in this request.

Guards raise instead of returning (value, response) tuples:
DemoReadOnly / RateLimited / TicketExpired / PayloadTooLarge propagate
to the app-level ApiError handler, which renders the same
bodies the tuple plumbing used to.
"""

from __future__ import annotations

import math

from starlette.requests import Request

from ..auth import session as auth_session
from ..auth.ticket import consume_guest_ticket
from ..contracts.payloads import AuthTicketPayload
from ..demo import is_read_only
from ..errors import DemoReadOnly, PayloadTooLarge, RateLimited
from .ratelimit import RateLimitConfig, allow, client_ip

# Every organizer write passes a per-organizer rate bucket (the cabinet
# CRUD routes had none): abuse protection, not auth — the caller is
# already authenticated. Keyed by organizer id; anonymous callers
# bucket by IP. Consulted *before* the demo refusal, so the cheap 403
# is not hammerable for free. Reads are unmetered — read limiting is
# delegated to the edge (Vercel).
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


async def require_guest_identity(ticket: str) -> AuthTicketPayload:
    """Redeem a guest auth ticket for the messenger identity behind it —
    the guest counterpart of require_writable_organizer, for the paths
    where consuming the ticket IS the operation (booking lookup). The
    booking-create path defers redemption to the service layer
    (ADR-024 B1) so domain refusals leave the ticket intact — both go
    through auth.ticket.consume_guest_ticket, so the single-use +
    purpose-check semantics are identical."""
    return await consume_guest_ticket(ticket)


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
