"""Internal service-to-service route tests: the Auth.js organizer
lookup behind POST /api/internal/auth/organizer-by-messenger.

The route answers over generated envelopes — the InternalOrganizerRecord
UUID field carries a pattern constraint Pydantic cannot apply to a
coerced UUID, so the handler must build it via model_construct. A plain
constructor turns every "organizer found" answer into a 500 and breaks
Auth.js login — this file pins the happy path."""

from __future__ import annotations

import pytest

from ._helpers import TEST_SECRET, body_json, register_organizer

pytestmark = pytest.mark.usefixtures("_require_postgres")

PATH = "/api/internal/auth/organizer-by-messenger"


def _internal_headers() -> dict[str, str]:
    from countmein.auth.internal import derived_internal_secret

    return {"x-internal-secret": derived_internal_secret(TEST_SECRET)}


async def test_internal_lookup_by_messenger(client, fake_redis, db):
    """The Auth.js sign-in path: messenger identity → organizer record."""
    org = await register_organizer(client, fake_redis, "int-lookup-01")

    r = await client.post(
        PATH,
        headers=_internal_headers(),
        json={"messenger": "telegram", "messengerId": f"route-{org['slug']}"},
    )
    assert r.status_code == 200, r.text
    body = body_json(r)
    assert body["organizer"]["id"] == org["id"]
    assert body["organizer"]["slug"] == org["slug"]
    assert body["organizer"]["name"] == "Route Test Organizer"


async def test_internal_lookup_by_organizer_id(client, fake_redis, db):
    """The jwt/session path: organizerId → organizer record."""
    org = await register_organizer(client, fake_redis, "int-lookup-02")

    r = await client.post(
        PATH,
        headers=_internal_headers(),
        json={"organizerId": org["id"]},
    )
    assert r.status_code == 200, r.text
    assert body_json(r)["organizer"]["id"] == org["id"]


async def test_internal_lookup_miss_and_auth(client, fake_redis, db):
    """A miss is a 404 (Next maps it to null); a wrong or absent secret
    is a 401 — the route must never answer without the internal key."""
    headers = _internal_headers()
    r = await client.post(
        PATH,
        headers=headers,
        json={"messenger": "telegram", "messengerId": "no-such-user"},
    )
    assert r.status_code == 404

    r = await client.post(
        PATH,
        headers={"x-internal-secret": "wrong"},
        json={"messenger": "telegram", "messengerId": "no-such-user"},
    )
    assert r.status_code == 401

    r = await client.post(PATH, json={"messenger": "telegram", "messengerId": "no-such-user"})
    assert r.status_code == 401


async def test_internal_lookup_rejects_empty_criteria(client, fake_redis, db):
    """Neither criterion present → 400 InvalidInput, not a silent miss."""
    r = await client.post(PATH, headers=_internal_headers(), json={})
    assert r.status_code == 400
