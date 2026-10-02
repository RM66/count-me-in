"""Public catalog route tests: the Phase 4 read surface against a live
Postgres — organizer/service/sitemap envelopes and the one-join service
lookup behind get_public_service (service + parent organizer in a single
query; the FK makes a dangling organizer impossible, so an unknown id is
the only miss and both miss shapes answer 404)."""

from __future__ import annotations

import uuid

import pytest

from ._helpers import (
    auth_headers,
    body_json,
    create_service,
    create_slot,
    register_organizer,
)

pytestmark = pytest.mark.usefixtures("_require_postgres")


async def test_public_organizer_view(client, fake_redis, db):
    """The public organizer view: profile + services + upcoming slots."""
    org = await register_organizer(client, fake_redis, "pub-org-01")
    headers = auth_headers(sub=org["id"], slug=org["slug"])
    svc = await create_service(client, headers)
    await create_slot(client, headers, svc["id"])

    r = await client.get(f"/api/public/organizers/{org['slug']}")
    assert r.status_code == 200, r.text
    view = body_json(r)
    assert view["organizer"]["slug"] == org["slug"]
    assert [s["id"] for s in view["services"]] == [svc["id"]]
    assert len(view["slots"]) == 1

    r = await client.get("/api/public/organizers/missing-slug")
    assert r.status_code == 404


async def test_public_service_view_one_join(client, fake_redis, db):
    """get_public_service resolves service + organizer in one query and
    serves the envelope; an unknown id misses the join → 404."""
    org = await register_organizer(client, fake_redis, "pub-srv-01")
    headers = auth_headers(sub=org["id"], slug=org["slug"])
    svc = await create_service(client, headers)
    slot = await create_slot(client, headers, svc["id"])

    r = await client.get(f"/api/public/services/{svc['id']}")
    assert r.status_code == 200, r.text
    view = body_json(r)
    assert view["service"]["id"] == svc["id"]
    assert view["organizer"]["slug"] == org["slug"]
    assert [s["id"] for s in view["slots"]] == [slot["id"]]

    r = await client.get(f"/api/public/services/{uuid.uuid4()}")
    assert r.status_code == 404


async def test_public_sitemap(client, fake_redis, db):
    """The sitemap catalog lists the registered organizer and service."""
    org = await register_organizer(client, fake_redis, "pub-map-01")
    headers = auth_headers(sub=org["id"], slug=org["slug"])
    svc = await create_service(client, headers)

    r = await client.get("/api/public/sitemap")
    assert r.status_code == 200
    catalog = body_json(r)
    assert org["slug"] in [e["slug"] for e in catalog["organizers"]]
    assert {"orgSlug": org["slug"], "serviceId": svc["id"]} in [
        {"orgSlug": e["orgSlug"], "serviceId": e["serviceId"]} for e in catalog["services"]
    ]
