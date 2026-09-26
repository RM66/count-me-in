"""Request-level guards: who is allowed to write in this request."""

from __future__ import annotations

from starlette.requests import Request

from .. import logx
from ..auth import session as auth_session
from ..auth.telegram import TICKET_PURPOSE_GUEST
from ..auth.ticket import consume_ticket
from ..contracts.payloads import AuthTicketPayload
from ..demo import is_read_only
from ..i18n.locale import detect_locale
from .ratelimit import RateLimitConfig, allow, client_ip, too_many_requests
from .response import Response, demo_read_only, empty, error, error_params

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


def _request_locale(request: Request) -> str:
    return detect_locale(request.cookies, request.headers.get("accept-language", ""))


async def require_writable_organizer(request: Request) -> tuple[str, Response | None]:
    """Who is allowed to *write* in this request. Anonymous callers are
    demo-cabinet visitors (/cabinet needs no session, ADR-010), so they
    get the same DEMO_READ_ONLY refusal as the demo id itself rather
    than a bare 401. The policy lives in demo/; this is its
    request-level door.

    Returns (organizer_id, None) when the caller may proceed, or
    ("", resp) on refusal — resp is already rendered, the caller writes
    it and returns."""
    organizer_id = auth_session.session_organizer_id(request)
    if organizer_id == "":
        bucket = "rl:organizer-write:anon:" + client_ip(request)
    else:
        bucket = "rl:organizer-write:" + organizer_id
    allowed, retry_after = await allow(bucket, _ORGANIZER_WRITE_LIMIT)
    if not allowed:
        return "", too_many_requests(_request_locale(request), retry_after)
    if is_read_only(organizer_id):
        return "", demo_read_only(_request_locale(request))
    return organizer_id, None


async def require_guest_identity(
    request: Request, ticket: str
) -> tuple[AuthTicketPayload | None, Response | None]:
    """Redeem a guest auth ticket for the messenger identity behind it —
    the guest counterpart of require_writable_organizer. The ticket is
    consumed (GETDEL), not peeked: single-use, so a replayed request
    finds nothing and is refused. The only way a guest identity may enter
    a write: invariant 8 says it comes from a server-validated widget
    payload, never from raw client input."""
    locale = _request_locale(request)
    try:
        payload = await consume_ticket(ticket)
    except Exception as err:
        logx.error(err, {"scope": "consume-ticket"})
        return None, empty(500)
    # Purpose claim: a ticket minted for organizer registration must not
    # be redeemable in the booking flow. Answered like an expired one —
    # the caller cannot distinguish "wrong flow" from "unknown ticket".
    if payload is None or payload.purpose != TICKET_PURPOSE_GUEST:
        return None, error_params(401, locale, "ticketExpired", None)
    return payload, None


async def read_body_or_413(request: Request) -> tuple[bytes | None, Response | None]:
    """Read the raw request body, bounded at 1MB, and answer 413 when
    the body exceeds the bound. Returns (body, None) when the caller
    may proceed; (None, resp) when the refusal has already been
    rendered and the caller must return. A truncated body would
    otherwise surface as a confusing 400 "invalid JSON" instead of the
    honest size refusal."""
    max_body = 1 << 20
    body = await request.body()
    if len(body) > max_body:
        resp = error(413, _request_locale(request), "bodyTooLarge")
        resp.headers = {**resp.headers, "Connection": "close"}
        return None, resp
    return body, None
