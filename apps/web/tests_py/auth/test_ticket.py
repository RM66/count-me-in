"""Single-use tickets and one-time login links, against fakeredis."""

from __future__ import annotations

import pytest
from _lib.countmein import redis as redis_mod
from _lib.countmein.auth.telegram import (
    TICKET_PURPOSE_GUEST,
    TICKET_PURPOSE_ORGANIZER,
)
from _lib.countmein.auth.ticket import (
    consume_login_link,
    consume_ticket,
    issue_login_link,
    issue_ticket,
    peek_login_link,
    peek_ticket,
    ticket_key,
)
from _lib.countmein.contracts.constants_gen import LOGIN_LINK_TTL_SECONDS
from _lib.countmein.contracts.domain import login_link_key
from _lib.countmein.contracts.payloads import AuthTicketPayload


@pytest.fixture()
async def fake_redis(monkeypatch):
    import fakeredis.aioredis

    fake = fakeredis.aioredis.FakeRedis()
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(redis_mod, "client", lambda: fake)
    yield fake
    await fake.aclose()


def ticket_payload(purpose: str) -> AuthTicketPayload:
    return AuthTicketPayload(
        messenger="telegram",
        messenger_id="123456789",
        display_name="Ann",
        messenger_login=None,
        purpose=purpose,
    )


async def test_issue_peek_consume_ticket(fake_redis):
    token = await issue_ticket(ticket_payload(TICKET_PURPOSE_GUEST))
    assert len(token) == 43, "ticket must be a 43-char base64url token"

    # Peek does not consume — the registration flow reads the ticket
    # while the Auth.js sign-in still needs it.
    peeked = await peek_ticket(token)
    assert peeked is not None
    assert peeked.messenger_id == "123456789"
    assert peeked.purpose == TICKET_PURPOSE_GUEST
    assert await peek_ticket(token) is not None, "a second Peek must still find the ticket"

    # Consume returns the payload and deletes the key.
    consumed = await consume_ticket(token)
    assert consumed is not None
    assert consumed.messenger_id == "123456789"

    # Single-use: a second consume finds nothing — this is what makes a
    # replayed booking fail (invariant 8).
    assert await consume_ticket(token) is None


async def test_consume_ticket_unknown(fake_redis):
    assert await consume_ticket("no-such-ticket") is None


async def test_ticket_ttl_expires(fake_redis):
    token = await issue_ticket(ticket_payload(TICKET_PURPOSE_GUEST))
    # Advance the fake clock past the TTL — the key evaporates.
    await fake_redis.expire(ticket_key(token), 0)
    assert await consume_ticket(token) is None


async def test_ticket_purpose_round_trip(fake_redis):
    # guest ≠ signup: the purpose claim survives the Redis round trip,
    # so require_guest_identity can refuse a registration ticket.
    for purpose in (TICKET_PURPOSE_GUEST, TICKET_PURPOSE_ORGANIZER):
        token = await issue_ticket(ticket_payload(purpose))
        payload = await consume_ticket(token)
        assert payload is not None
        assert payload.purpose == purpose


async def test_consume_ticket_broken_payload(fake_redis):
    # Corrupt JSON behind the key is "no payload usable" → None, not an
    # error: the caller answers 401 like an unknown ticket.
    await fake_redis.set("auth:ticket:broken", "{not json")
    assert await consume_ticket("broken") is None


async def test_consume_ticket_redis_down(monkeypatch):
    """A Redis failure propagates as an error (identity is not
    fail-open, ADR-019); the route answers 500."""

    class Dead:
        async def getdel(self, *a, **kw):
            raise ConnectionError("redis down")

    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(redis_mod, "client", lambda: Dead())
    with pytest.raises(Exception):
        await consume_ticket("any")


# ── Login links ───────────────────────────────────────────────────────────────


async def test_login_link_round_trip(fake_redis):
    token = await issue_login_link("01930000-0000-7000-8000-000000000001", "/cabinet/bookings")

    peeked = await peek_login_link(token)
    assert peeked is not None
    assert peeked.organizer_id == "01930000-0000-7000-8000-000000000001"
    assert peeked.next == "/cabinet/bookings"
    # Peek is not consume — the landing page may look without spending.
    assert await peek_login_link(token) is not None

    consumed = await consume_login_link(token)
    assert consumed is not None
    # Single-use: the POST that consumes is the only redemption.
    assert await consume_login_link(token) is None


async def test_login_link_unknown_token(fake_redis):
    assert await consume_login_link("no-such-token") is None


async def test_login_link_ttl(fake_redis):
    """The stored TTL is the contracts constant — pin the key's lifetime
    to it (30 days) rather than to an arbitrary number in this file."""
    token = await issue_login_link("01930000-0000-7000-8000-000000000002", "/cabinet")
    ttl = await fake_redis.ttl(login_link_key(token))
    assert ttl == LOGIN_LINK_TTL_SECONDS


async def test_login_link_rejects_absolute_next(fake_redis):
    """Open-redirect guard: `next` is stored with the token, but a
    payload carrying an absolute URL (or an empty organizer id) is
    unusable — answered like an unknown token, None."""
    cases = {
        "absolute next": '{"organizerId":"01930000-0000-7000-8000-000000000003","next":"https://evil.example.com"}',
        "protocol-relative": '{"organizerId":"01930000-0000-7000-8000-000000000003","next":"//evil.example.com"}',
        "backslash trick": '{"organizerId":"01930000-0000-7000-8000-000000000003","next":"/\\\\evil.example.com"}',
        "inner backslash": '{"organizerId":"01930000-0000-7000-8000-000000000003","next":"/cabinet\\\\bookings"}',
        "newline": '{"organizerId":"01930000-0000-7000-8000-000000000003","next":"/cabinet\\nbookings"}',
        "carriage return": '{"organizerId":"01930000-0000-7000-8000-000000000003","next":"/cabinet\\rbookings"}',
        "empty next": '{"organizerId":"01930000-0000-7000-8000-000000000003","next":""}',
        "empty org id": '{"organizerId":"","next":"/cabinet"}',
        "broken payload": "{not json",
    }
    for name, raw in cases.items():
        token = "link-" + name.replace(" ", "-")
        await fake_redis.set(login_link_key(token), raw)
        assert await peek_login_link(token) is None, f"{name}: must be unusable"


async def test_login_link_accepts_cabinet_paths(fake_redis):
    for next_ in ("/cabinet", "/cabinet/bookings", "/cabinet/services/abc"):
        token = "link-ok-" + next_.replace("/", "-")
        raw = '{"organizerId":"01930000-0000-7000-8000-000000000003","next":' + f'"{next_}"' + "}"
        await fake_redis.set(login_link_key(token), raw)
        payload = await peek_login_link(token)
        assert payload is not None and payload.next == next_
