"""Plain helpers for the route tests — session minting and
API-driven seeding. Fixtures live in conftest.py (same directory)."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any

import httpx
from _lib.countmein.auth.session import ORGANIZER_AUTH_HEADER

TEST_SECRET = "route-test-golden-secret"
BASE = "http://testserver"


def mint_session(secret: str, sub: str, slug: str, exp: int | None = None) -> str:
    """The shared organizer-auth mint (the derivation itself is pinned
    by tests_py/auth/test_session.py)."""
    import base64

    from _lib.countmein.auth.session import derived_signing_key

    header = (
        base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
        .rstrip(b"=")
        .decode()
    )
    now = int(time.time())
    payload = (
        base64.urlsafe_b64encode(
            json.dumps(
                {
                    "sub": sub,
                    "slug": slug,
                    "iat": now,
                    "exp": exp if exp is not None else now + 3600,
                }
            ).encode()
        )
        .rstrip(b"=")
        .decode()
    )
    signing_input = f"{header}.{payload}"
    sig = hmac.new(derived_signing_key(secret), signing_input.encode(), hashlib.sha256).digest()
    return f"{signing_input}.{base64.urlsafe_b64encode(sig).rstrip(b'=').decode()}"


def auth_headers(
    secret: str = TEST_SECRET, sub: str = "org-route-test-0001", slug: str = "rtest"
) -> dict:
    return {ORGANIZER_AUTH_HEADER: mint_session(secret, sub, slug)}


def body_json(r: httpx.Response) -> dict[str, Any]:
    return json.loads(r.content.decode()) if r.content else {}


async def register_organizer(client: httpx.AsyncClient, fake_redis, slug: str) -> dict:
    """Register an organizer through the API; returns the response body
    (id + slug) for session minting. The slug gets a per-process suffix
    — the shared dev Postgres keeps rows across runs, and a re-run must
    not collide with the previous one's slug."""
    import secrets

    from _lib.countmein.auth.telegram import TICKET_PURPOSE_ORGANIZER
    from _lib.countmein.auth.ticket import issue_ticket
    from _lib.countmein.contracts.payloads import AuthTicketPayload

    suffix = secrets.token_hex(3)
    slug = f"{slug}-{suffix}"
    ticket = await issue_ticket(
        AuthTicketPayload(
            messenger="telegram",
            messenger_id=f"route-{slug}",
            display_name="Route Test",
            purpose=TICKET_PURPOSE_ORGANIZER,
        )
    )
    r = await client.post(
        "/api/organizers",
        json={
            "ticket": ticket,
            "slug": slug,
            "name": "Route Test Organizer",
            "timezone": "Europe/Belgrade",
            "language": "en",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["organizer"]


async def create_service(
    client: httpx.AsyncClient, headers: dict, title: str = "Route Yoga"
) -> dict:
    r = await client.post(
        "/api/services",
        headers=headers,
        json={
            "title": title,
            "defaultPrice": "20.00",
            "defaultCapacity": 10,
            "defaultDurationMinutes": 60,
            "maxSeatsPerBooking": 4,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["service"]


async def create_slot(client: httpx.AsyncClient, headers: dict, service_id: str) -> dict:
    r = await client.post(
        "/api/slots",
        headers=headers,
        json={
            "serviceId": service_id,
            "startsAt": "2031-06-01T10:00:00Z",
            "durationMinutes": 60,
            "capacity": 3,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["slot"]
