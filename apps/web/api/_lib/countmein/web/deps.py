"""FastAPI dependencies: the shared handler preamble as Depends.

Every write handler used to repeat the same ~8 lines — rate limit →
read body → decode → guard. Here each step is a dependency the handler
declares in its signature; FastAPI resolves them in declaration order,
which pins the order of side effects:

1. rate limit (before any body is read),
2. body read (bounded, 413),
3. decode (a validation failure must NOT consume the guest ticket —
   the ticket dependency sits after the decode dependency),
4. identity/session guards.

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
    from redis.asyncio import Redis
    from sqlalchemy.ext.asyncio import AsyncEngine


def get_db_engine(request: Request) -> AsyncEngine:
    """The request's Postgres engine. `app.state.db_engine` (set by a
    test or an embedding) wins over the process-wide lazy singleton
    (ADR-021) — the override is how unit tests isolate themselves
    under parallel runs; `app.dependency_overrides[get_db_engine]`
    works too, this is the same seam one level down."""
    override: AsyncEngine | None = getattr(request.app.state, "db_engine", None)
    if override is not None:
        return override
    from ..db.client import engine

    return engine()


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


def rate_limit(key: Callable[[Request], str], limit: int, window: float) -> Callable[..., Any]:
    """Dependency factory: enforce a sliding-window bucket keyed by
    `key(request)` (IP, organizer id, …). Raises RateLimited (429 with
    Retry-After) when exhausted; fails open on a Redis outage (ADR-019)."""

    async def dep(request: Request) -> None:
        allowed_flag, retry_after = await allow(
            key(request), RateLimitConfig(limit=limit, window=window)
        )
        if not allowed_flag:
            raise RateLimited(math.ceil(retry_after))

    dep.__countmein_stage__ = _STAGE_RATE_LIMIT  # type: ignore[attr-defined]
    return dep


def organizer_rate_limit(prefix: str, limit: int, window: float) -> Callable[..., Any]:
    """Dependency factory: a bucket keyed by the signed-in organizer's
    id — runs after (and therefore only for) a writable organizer."""

    async def dep(organizer_id: str = Depends(require_writable_organizer)) -> None:
        allowed_flag, retry_after = await allow(
            prefix + organizer_id, RateLimitConfig(limit=limit, window=window)
        )
        if not allowed_flag:
            raise RateLimited(math.ceil(retry_after))

    dep.__countmein_stage__ = _STAGE_RATE_LIMIT  # type: ignore[attr-defined]
    return dep


def ip_rate_limit(prefix: str, limit: int, window: float) -> Callable[..., Any]:
    """Dependency factory: a bucket keyed by the caller's IP."""
    return rate_limit(lambda request: prefix + client_ip(request), limit, window)


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
    decoded* body (the decode dependency runs first — a validation
    failure must not burn the ticket) and redeem it for the messenger
    identity. Single-use: a replayed request finds nothing (401)."""

    async def dep(
        request: Request, body: ValidatedBody[Any] = Depends(decoded_dep)
    ) -> AuthTicketPayload:
        return await require_guest_identity(request, ticket_of(body.model))

    dep.__countmein_stage__ = _STAGE_TICKET  # type: ignore[attr-defined]
    return dep


# The canonical 8-4-4-4-12 hex form — the only shape the ids are ever
# minted in. uuid.UUID() would also accept urn:uuid:… and {braced} forms,
# which Postgres rejects with a 500 instead of a clean 400.
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


def require_internal_secret(request: Request) -> None:
    """Validate the x-internal-secret header for service-to-service calls."""
    from ..auth.internal import INTERNAL_SECRET_HEADER, verify_internal_secret
    from ..errors import UnauthorizedInternal

    secret = request.headers.get(INTERNAL_SECRET_HEADER)
    if not verify_internal_secret(secret):
        raise UnauthorizedInternal()
