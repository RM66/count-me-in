"""FastAPI dependencies: the shared handler preamble as Depends.

Every write handler used to repeat the same ~8 lines — rate limit →
read body → decode → guard. Here each step is a dependency the handler
declares in its signature; FastAPI resolves them in declaration order,
which pins the order of side effects:

1. rate limit (before any body is read),
2. body read (bounded, 413),
3. decode (a validation failure must NOT consume the guest ticket —
   the ticket dependency sits after the decode dependency),
4. identity/session guards — guest-ticket *redemption* is deferred to
   the service layer on booking_create (ADR-024 B1), so a domain
   refusal leaves the ticket reusable; the dependency stage only
   extracts the raw ticket from the decoded body.

Errors raised here are the same exceptions the handlers raise
(RateLimited, PayloadTooLarge, ValidationFailed, …) and are rendered by
the app-level exception handlers, so the wire bytes are unchanged.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from fastapi import Depends
from starlette.requests import Request

from ..contracts.payloads import AuthTicketPayload
from ..errors import InvalidInput, RateLimited, UnsupportedMediaType
from .guards import read_body_or_413, require_guest_identity, require_writable_organizer
from .ratelimit import RateLimitConfig, allow, client_ip

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from redis.asyncio import Redis
    from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession


def get_db_engine(request: Request) -> AsyncEngine:
    """The request's Postgres engine. `app.state.db_engine` (set by a
    test or an embedding) wins over the process-wide lazy singleton
    (ADR-021) — how unit tests isolate under parallel runs;
    `app.dependency_overrides[get_db_engine]` works too, same seam one
    level down."""
    override: AsyncEngine | None = getattr(request.app.state, "db_engine", None)
    if override is not None:
        return override
    from ..db.client import engine

    return engine()


async def get_db_session(request: Request) -> AsyncIterator[AsyncSession]:
    """The request-scoped AsyncSession — bound to the request's engine
    (get_db_engine's override seam) so dependency_overrides and
    app-state engines both reach it.

    Handlers declare `Depends(get_db_session)` and pass the session to
    services; a handler NEVER opens its own sessionmaker. FastAPI closes
    it after the response; a tx left open by an exception is rolled back
    here so the connection returns to the pool clean."""
    from ..db.client import sessionmaker_for

    async with sessionmaker_for(get_db_engine(request))() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


def get_redis(request: Request) -> Redis:
    """The request's Redis client — same override seam as
    get_db_engine (`app.state.redis_client`)."""
    override: Redis | None = getattr(request.app.state, "redis_client", None)
    if override is not None:
        return override
    from .. import redis as redis_mod

    return redis_mod.client()


async def locale(request: Request) -> str:
    """The caller's locale (ADR-011): cookie → Accept-Language → en."""
    from ..i18n.locale import detect_locale

    return detect_locale(request.cookies, request.headers.get("accept-language", ""))


async def request_body(request: Request) -> bytes:
    """The raw request body, bounded at 1MB (413 past the bound)."""
    return await read_body_or_413(request)


# Pipeline stages, tagged on the dependency callables so the dependency-
# order meta-test (tests_py/routes/test_dependency_order.py) can assert
# the load-bearing sequence without guessing from names.
_STAGE_RATE_LIMIT = "ratelimit"
_STAGE_BODY = "body"
_STAGE_DECODE = "decode"
_STAGE_TICKET = "ticket"

request_body.__countmein_stage__ = _STAGE_BODY  # type: ignore[attr-defined]


@dataclass
class ValidatedBody[T]:
    """A decoded request body plus the raw bytes it came from — the raw
    bytes are what merge-patch handlers need (patch_keys, merge)."""

    model: T
    raw: bytes


def decoded(decoder: Callable[[bytes], Any]) -> Callable[..., Any]:
    """Dependency factory: read the body once and validate it. The same
    factory instance is shared between the handler parameter and the
    identity dependency, so FastAPI's per-request cache decodes once."""

    async def dep(body: bytes = Depends(request_body)) -> ValidatedBody[Any]:
        return ValidatedBody(decoder(body), body)

    dep.__countmein_stage__ = _STAGE_DECODE  # type: ignore[attr-defined]
    return dep


def organizer_rate_limit(prefix: str, limit: int, window: float) -> Callable[..., Any]:
    """Dependency factory: a bucket keyed by the signed-in organizer's
    id — runs after (and therefore only for) a writable organizer."""

    async def dep(organizer_id: str = Depends(require_writable_organizer)) -> None:
        allowed_flag, retry_after = await allow(
            prefix + organizer_id,
            RateLimitConfig(limit=limit, window=window, label=prefix),
        )
        if not allowed_flag:
            raise RateLimited(math.ceil(retry_after))

    dep.__countmein_stage__ = _STAGE_RATE_LIMIT  # type: ignore[attr-defined]
    return dep


# Dedicated bucket for trusted server-side calls. The Next.js BFF's
# SSR fetches share Vercel's egress IPs: a crawler burst would drain
# the public bucket and 429 every SSR fetch site-wide (ADR-023). A
# valid x-internal-secret counts here instead — still a real bucket (a
# runaway loop trips 429, not unbounded Postgres), and a forged/absent
# secret gets the normal IP bucket: the check is cryptographic.
_INTERNAL_SSR_KEY = "rl:internal-ssr:"
_INTERNAL_SSR_CFG = RateLimitConfig(limit=10_000, window=60.0, label=_INTERNAL_SSR_KEY)


def ip_rate_limit(prefix: str, limit: int, window: float) -> Callable[..., Any]:
    """Dependency factory: a bucket keyed by the caller's IP — except
    trusted server-side calls (valid x-internal-secret), which count
    against the internal bucket above. Raises RateLimited (429 +
    Retry-After) when exhausted; fails open on a Redis outage
    (ADR-019)."""

    async def dep(request: Request) -> None:
        from ..auth.internal import INTERNAL_SECRET_HEADER, verify_internal_secret

        if verify_internal_secret(request.headers.get(INTERNAL_SECRET_HEADER)):
            key, cfg = _INTERNAL_SSR_KEY, _INTERNAL_SSR_CFG
        else:
            key, cfg = (
                prefix + client_ip(request),
                RateLimitConfig(limit=limit, window=window, label=prefix),
            )
        allowed_flag, retry_after = await allow(key, cfg)
        if not allowed_flag:
            raise RateLimited(math.ceil(retry_after))

    dep.__countmein_stage__ = _STAGE_RATE_LIMIT  # type: ignore[attr-defined]
    return dep


def merge_patch_content_type(request: Request) -> None:
    """415 unless the request declares the RFC 7386 media type — the
    merge semantics belong to the media type, not the body."""
    ct = request.headers.get("content-type", "")
    if ct == "" or ct.split(";", 1)[0].strip() != "application/merge-patch+json":
        raise UnsupportedMediaType()


def guest_identity(
    decoded_dep: Callable[..., Any],
    ticket_of: Callable[[Any], str],
) -> Callable[..., Any]:
    """Dependency factory: consume the guest ticket from the *already
    decoded* body (decode runs first — a validation failure must not
    burn the ticket) and redeem it for the messenger identity. For the
    lookups, where consuming the ticket IS the operation. Single-use:
    a replay finds nothing (401)."""

    async def dep(body: ValidatedBody[Any] = Depends(decoded_dep)) -> AuthTicketPayload:
        return await require_guest_identity(ticket_of(body.model))

    dep.__countmein_stage__ = _STAGE_TICKET  # type: ignore[attr-defined]
    return dep


def guest_ticket(
    decoded_dep: Callable[..., Any],
    ticket_of: Callable[[Any], str],
) -> Callable[..., Any]:
    """Dependency factory: hand the *raw* ticket from the decoded body
    to the handler — no redemption. For booking_create, where the
    service consumes the ticket only after the domain refusals
    (ADR-024 B1): a SoldOut/InvalidOptions/PartyTooLarge answer must
    leave it reusable. Same pipeline position as guest_identity."""

    async def dep(body: ValidatedBody[Any] = Depends(decoded_dep)) -> str:
        return ticket_of(body.model)

    dep.__countmein_stage__ = _STAGE_TICKET  # type: ignore[attr-defined]
    return dep


# The canonical 8-4-4-4-12 hex form — the only shape ids are minted in.
# uuid.UUID() would also accept urn:uuid:… and {braced} forms, which
# Postgres rejects with a 500 instead of a clean 400.
_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def uuid_path_param(name: str = "id") -> Callable[..., Any]:
    """Dependency factory: validate a UUID path parameter (400 with the
    JSON error envelope on a malformed value) — one rule for every
    {id} route that takes a UUID (slots; services use slugs)."""

    async def dep(request: Request) -> str:
        value = str(request.path_params.get(name, ""))
        if not _UUID_RE.fullmatch(value):
            raise InvalidInput() from None
        return value

    return dep


def cabinet_organizer(request: Request) -> tuple[str, bool]:
    """The organizer this request may view (signed-in, or demo for
    anonymous visitors, ADR-010) — the read-side scope."""
    from ..demo.resolve import resolve_cabinet_organizer_id

    return resolve_cabinet_organizer_id(request)


def session_organizer(request: Request) -> str:
    """The signed-in organizer's id, "" when anonymous (no demo
    fallback) — for handlers that need the raw session, not the
    write guard."""
    from ..auth.session import session_organizer_id

    return session_organizer_id(request)


def session_slug(request: Request) -> str:
    """The signed-in organizer's slug claim, "" when anonymous — the
    public-cache tag a mutation invalidates (ADR-023). Read-only; guards
    still declare require_writable_organizer separately."""
    from ..auth.session import session_from_request

    session = session_from_request(request)
    return session.slug if session is not None else ""


def require_internal_secret(request: Request) -> None:
    """Validate the x-internal-secret header for service-to-service calls."""
    from ..auth.internal import INTERNAL_SECRET_HEADER, verify_internal_secret
    from ..errors import UnauthorizedInternal

    secret = request.headers.get(INTERNAL_SECRET_HEADER)
    if not verify_internal_secret(secret):
        raise UnauthorizedInternal()
