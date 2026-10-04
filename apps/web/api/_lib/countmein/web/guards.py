"""Request-level guards: who is allowed to write in this request.

Guards raise instead of returning (value, response) tuples:
DemoReadOnly / RateLimited / TicketExpired / PayloadTooLarge propagate
to the app-level ApiError handler, which renders the same
bodies the tuple plumbing used to.
"""

from __future__ import annotations

from fastapi import Depends
from starlette.requests import Request

from ..auth import session as auth_session
from ..auth.session import Session
from ..auth.ticket import consume_guest_ticket
from ..contracts.payloads import AuthTicketPayload
from ..demo import is_read_only
from ..errors import DemoReadOnly, PayloadTooLarge
from .ratelimit import RateLimitConfig, client_ip, enforce

# Every organizer write passes a per-organizer rate bucket: abuse
# protection, not auth — the caller is already authenticated. Anonymous
# callers bucket by IP. Consulted *before* the demo refusal, so the
# cheap 403 is not hammerable for free. Reads are unmetered — delegated
# to the edge.
_ORGANIZER_WRITE_LIMIT = RateLimitConfig(limit=60, window=60.0)


def current_session(request: Request) -> Session | None:
    """The verified organizer session, or None when anonymous — the one
    place the organizer-auth JWT is parsed per request. Every
    session-derived dependency declares Depends(current_session), so
    FastAPI's per-request dependency cache shares this single parse."""
    return auth_session.session_from_request(request)


async def require_writable_organizer(
    request: Request,
    session: Session | None = Depends(current_session),
) -> str:
    """Who may *write* in this request. Anonymous callers are
    demo-cabinet visitors (/cabinet needs no session, ADR-010) and get
    the same DEMO_READ_ONLY refusal as the demo id, not a bare 401. The
    policy lives in demo/; this is its request-level door."""
    organizer_id = session.organizer_id if session is not None else ""
    if organizer_id == "":
        bucket = "rl:organizer-write:anon:" + client_ip(request)
    else:
        bucket = "rl:organizer-write:" + organizer_id
    await enforce(bucket, _ORGANIZER_WRITE_LIMIT)
    if is_read_only(organizer_id):
        raise DemoReadOnly()
    return organizer_id


async def require_guest_identity(ticket: str) -> AuthTicketPayload:
    """Redeem a guest auth ticket for the messenger identity — the guest
    counterpart of require_writable_organizer, for paths where consuming
    the ticket IS the operation (booking lookup). booking_create defers
    redemption to the service (ADR-024 B1) so refusals leave the ticket
    intact — both go through auth.ticket.consume_guest_ticket, so
    single-use + purpose-check semantics are identical."""
    return await consume_guest_ticket(ticket)


async def read_body_or_413(request: Request) -> bytes:
    """Read the raw request body, bounded at 1MB → 413 past the bound.
    Read incrementally so a 2GB upload is refused at the bound, not
    buffered — Content-Length is honored early when present (a lying
    header still gets caught by the read)."""
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
