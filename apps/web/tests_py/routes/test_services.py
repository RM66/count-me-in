"""Service route tests: create/list/get/patch/delete, merge-patch
pair rule (options + optionsSelectMode), demo refusal, 404, delete 409
guard, validation envelope."""

from __future__ import annotations

import json

from countmein.contracts.constants_gen import DEMO_ORGANIZER_ID, DEMO_READ_ONLY_CODE

from ._helpers import (
    auth_headers,
    body_json,
    create_service,
    register_organizer,
)


async def _setup(client, fake_redis, db, slug):
    org = await register_organizer(client, fake_redis, slug)
    headers = {**auth_headers(sub=org["id"], slug=org["slug"])}
    return org, headers


async def test_services_list_empty_for_signed_in(client, fake_redis, db):
    _, headers = await _setup(client, fake_redis, db, "svc-list-01")
    r = await client.get("/api/services", headers=headers)
    assert r.status_code == 200
    assert r.json()["services"] == []


async def test_service_create_and_get(client, fake_redis, db):
    _, headers = await _setup(client, fake_redis, db, "svc-create-01")
    svc = await create_service(client, headers, title="Route Yoga")
    r = await client.get(f"/api/services/{svc['id']}", headers=headers)
    assert r.status_code == 200
    assert r.json()["service"]["id"] == svc["id"]
    assert r.json()["service"]["title"] == "Route Yoga"


async def test_service_create_validation_error(client, fake_redis, db):
    _, headers = await _setup(client, fake_redis, db, "svc-create-02")
    r = await client.post("/api/services", headers=headers, json={"title": "Bad"})
    assert r.status_code == 400
    body = body_json(r)
    assert body.get("error")
    assert "details" in body


async def test_service_create_anonymous_403(client, fake_redis):
    r = await client.post("/api/services", json={"title": "Anon"})
    assert r.status_code == 403


async def test_service_create_demo_refused(client, fake_redis):
    headers = {**auth_headers(sub=DEMO_ORGANIZER_ID, slug="demo")}
    r = await client.post("/api/services", headers=headers, json={"title": "Demo"})
    assert r.status_code == 403
    assert body_json(r).get("code") == DEMO_READ_ONLY_CODE


async def test_service_get_unknown_404(client, fake_redis, db):
    _, headers = await _setup(client, fake_redis, db, "svc-get-01")
    r = await client.get("/api/services/svc-doesnotexist00001", headers=headers)
    assert r.status_code == 404
    assert body_json(r).get("error")


async def test_service_patch_merge_patch_absent_keeps(client, fake_redis, db):
    _, headers = await _setup(client, fake_redis, db, "svc-patch-01")
    svc = await create_service(client, headers)
    r = await client.patch(
        f"/api/services/{svc['id']}",
        headers={**headers, "content-type": "application/merge-patch+json"},
        content=b'{"title": "Renamed"}',
    )
    assert r.status_code == 200
    body = r.json()["service"]
    assert body["title"] == "Renamed"
    assert body["defaultPrice"] == "20.00"


async def test_service_patch_null_clears(client, fake_redis, db):
    _, headers = await _setup(client, fake_redis, db, "svc-patch-02")
    svc = await create_service(client, headers)
    r = await client.patch(
        f"/api/services/{svc['id']}",
        headers={**headers, "content-type": "application/merge-patch+json"},
        content=b'{"description": null}',
    )
    assert r.status_code == 200
    assert r.json()["service"]["description"] is None


async def test_service_patch_options_pair_rule(client, fake_redis, db):
    # options + optionsSelectMode must be patched together: setting
    # options without the mode (or vice versa) is a validation error on
    # the merged state.
    _, headers = await _setup(client, fake_redis, db, "svc-patch-03")
    svc = await create_service(client, headers)
    r = await client.patch(
        f"/api/services/{svc['id']}",
        headers={**headers, "content-type": "application/merge-patch+json"},
        content=b'{"options": ["A"]}',
    )
    assert r.status_code == 400
    r = await client.patch(
        f"/api/services/{svc['id']}",
        headers={**headers, "content-type": "application/merge-patch+json"},
        content=b'{"optionsSelectMode": "single"}',
    )
    assert r.status_code == 400


async def test_service_patch_photo_cleanup_gets_pre_update_url(client, fake_redis, db, monkeypatch):
    """Pin for the identity-map trap: the fetched row reads as already-
    updated post-commit, so cleanup's `old` must come from the
    pre-update snapshot — otherwise old == new and the replaced cover
    leaks in R2."""
    org, headers = await _setup(client, fake_redis, db, "svc-photo-01")
    svc = await create_service(client, headers)

    from countmein import storage
    from countmein.routes import services as svc_routes

    # config() requires the full R2 set — setting only the public base
    # leaves the prefix check raising inside is_own_media_url (400).
    for name, value in (
        ("R2_ACCOUNT_ID", "test-account"),
        ("R2_ACCESS_KEY_ID", "test-access-key"),
        ("R2_SECRET_ACCESS_KEY", "test-secret-key"),
        ("R2_BUCKET", "test-bucket"),
        ("R2_PUBLIC_BASE_URL", "https://media.example.com"),
    ):
        monkeypatch.setenv(name, value)
    storage.reset_for_test()

    calls: list[tuple[str, str, str]] = []

    async def fake_cleanup(organizer_id: str, old_url: str, new_url: str) -> None:
        calls.append((organizer_id, old_url, new_url))

    async def _noop_revalidate(tags: list[str]) -> None:
        return None

    monkeypatch.setattr(svc_routes, "cleanup_replaced_media", fake_cleanup)
    monkeypatch.setattr(svc_routes, "trigger_revalidation", _noop_revalidate)

    base = f"https://media.example.com/organizers/{org['id']}"
    patch_headers = {**headers, "content-type": "application/merge-patch+json"}
    try:
        r = await client.patch(
            f"/api/services/{svc['id']}",
            headers=patch_headers,
            content=json.dumps({"photoUrl": f"{base}/first.jpg"}).encode(),
        )
        assert r.status_code == 200, r.text
        r = await client.patch(
            f"/api/services/{svc['id']}",
            headers=patch_headers,
            content=json.dumps({"photoUrl": f"{base}/second.jpg"}).encode(),
        )
        assert r.status_code == 200, r.text
        assert calls == [
            (org["id"], "", f"{base}/first.jpg"),
            (org["id"], f"{base}/first.jpg", f"{base}/second.jpg"),
        ]
    finally:
        storage.reset_for_test()


async def test_service_patch_nothing_to_update(client, fake_redis, db):
    _, headers = await _setup(client, fake_redis, db, "svc-patch-04")
    svc = await create_service(client, headers)
    r = await client.patch(
        f"/api/services/{svc['id']}",
        headers={**headers, "content-type": "application/merge-patch+json"},
        content=b"{}",
    )
    assert r.status_code == 400


async def test_service_delete_happy_path(client, fake_redis, db):
    _, headers = await _setup(client, fake_redis, db, "svc-del-01")
    svc = await create_service(client, headers)
    r = await client.delete(f"/api/services/{svc['id']}", headers=headers)
    assert r.status_code == 200
    r = await client.get(f"/api/services/{svc['id']}", headers=headers)
    assert r.status_code == 404


async def test_service_delete_unknown_404(client, fake_redis, db):
    _, headers = await _setup(client, fake_redis, db, "svc-del-02")
    r = await client.delete("/api/services/svc-doesnotexist00002", headers=headers)
    assert r.status_code == 404


async def test_service_delete_with_bookings_409(client, fake_redis, db):
    # A booking row (even cancelled) references the service's slot —
    # delete is terminal 409, never a 500.
    import uuid as _uuid

    from sqlalchemy import text

    from ._helpers import create_slot

    _, headers = await _setup(client, fake_redis, db, "svc-del-03")
    svc = await create_service(client, headers)
    slot = await create_slot(client, headers, svc["id"])
    import hashlib
    import secrets

    from countmein.db import client as db_client

    token = "tok-" + secrets.token_hex(16)
    async with db_client.engine().begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO bookings (id, time_slot_id, status, seats, guest_name, "
                "guest_messenger, guest_messenger_id, guest_locale, manage_token, "
                "manage_token_hash, manage_token_expires_at) VALUES ("
                ":bid, :slot, 'cancelled', 1, 'G', "
                "'telegram', 'svc-del-03', 'en', :token, "
                ":hash, now() + interval '1 day')"
            ),
            {
                "bid": str(_uuid.uuid4()),
                "slot": slot["id"],
                "token": token,
                "hash": hashlib.sha256(token.encode()).hexdigest(),
            },
        )
    r = await client.delete(f"/api/services/{svc['id']}", headers=headers)
    assert r.status_code == 409
    assert body_json(r).get("error")
