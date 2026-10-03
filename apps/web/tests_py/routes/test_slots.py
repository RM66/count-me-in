"""Slot route tests: create/list/get/patch/delete, malformed UUID
envelope, demo refusal, 404, delete 409 guard, capacity-below-
booked 409, validation envelope."""

from __future__ import annotations

from countmein.contracts.constants_gen import DEMO_ORGANIZER_ID, DEMO_READ_ONLY_CODE

from ._helpers import (
    auth_headers,
    body_json,
    create_service,
    create_slot,
    register_organizer,
)


async def _setup(client, fake_redis, db, slug):
    org = await register_organizer(client, fake_redis, slug)
    headers = {**auth_headers(sub=org["id"], slug=org["slug"])}
    return org, headers


async def test_slot_create_and_list(client, fake_redis, db):
    _, headers = await _setup(client, fake_redis, db, "slot-list-01")
    svc = await create_service(client, headers)
    slot = await create_slot(client, headers, svc["id"])
    r = await client.get("/api/slots", headers=headers)
    assert r.status_code == 200
    ids = [s["id"] for s in r.json()["slots"]]
    assert slot["id"] in ids


async def test_slot_create_foreign_service_404(client, fake_redis, db):
    # Ownership comes from the session: a serviceId belonging to
    # someone else answers 404, never a cross-tenant write.
    _, headers = await _setup(client, fake_redis, db, "slot-own-01")
    r = await client.post(
        "/api/slots",
        headers=headers,
        json={
            "serviceId": "svc-doesnotexist00003",
            "startsAt": "2031-06-01T10:00:00Z",
            "durationMinutes": 60,
            "capacity": 3,
        },
    )
    assert r.status_code == 404


async def test_slot_create_validation_error(client, fake_redis, db):
    _, headers = await _setup(client, fake_redis, db, "slot-val-01")
    r = await client.post("/api/slots", headers=headers, json={"capacity": 3})
    assert r.status_code == 400
    body = body_json(r)
    assert body.get("error")
    assert "details" in body


async def test_slot_create_demo_refused(client, fake_redis):
    headers = {**auth_headers(sub=DEMO_ORGANIZER_ID, slug="demo")}
    r = await client.post(
        "/api/slots",
        headers=headers,
        json={
            "serviceId": "svc-abcdefghij123456",
            "startsAt": "2031-06-01T10:00:00Z",
            "durationMinutes": 60,
            "capacity": 3,
        },
    )
    assert r.status_code == 403
    assert body_json(r).get("code") == DEMO_READ_ONLY_CODE


async def test_slot_malformed_uuid_json_envelope(client, fake_redis, db):
    # One malformed-UUID rule — the JSON invalidInput envelope,
    # on every /api/slots/{id} method.
    _, headers = await _setup(client, fake_redis, db, "slot-uuid-01")
    r = await client.get("/api/slots/not-a-uuid", headers=headers)
    assert r.status_code == 400
    assert body_json(r) == {"error": "Invalid input", "code": "invalidInput"}
    r = await client.delete("/api/slots/not-a-uuid", headers=headers)
    assert r.status_code == 400
    r = await client.patch(
        "/api/slots/not-a-uuid",
        headers={**headers, "content-type": "application/merge-patch+json"},
        content=b'{"capacity":5}',
    )
    assert r.status_code == 400


async def test_slot_get_unknown_404(client, fake_redis, db):
    _, headers = await _setup(client, fake_redis, db, "slot-get-01")
    r = await client.get("/api/slots/00000000-0000-0000-0000-000000000001", headers=headers)
    assert r.status_code == 404
    assert body_json(r).get("error")


async def test_slot_put_merge_patch_absent_keeps(client, fake_redis, db):
    _, headers = await _setup(client, fake_redis, db, "slot-patch-01")
    svc = await create_service(client, headers)
    slot = await create_slot(client, headers, svc["id"])
    r = await client.patch(
        f"/api/slots/{slot['id']}",
        headers={**headers, "content-type": "application/merge-patch+json"},
        content=b'{"capacity": 5}',
    )
    assert r.status_code == 200
    body = r.json()["slot"]
    assert body["capacity"] == 5
    assert body["durationMinutes"] == 60


async def test_slot_put_requires_merge_patch_media_type(client, fake_redis, db):
    _, headers = await _setup(client, fake_redis, db, "slot-patch-02")
    svc = await create_service(client, headers)
    slot = await create_slot(client, headers, svc["id"])
    r = await client.patch(
        f"/api/slots/{slot['id']}",
        headers={**headers, "content-type": "application/json"},
        content=b'{"capacity": 5}',
    )
    assert r.status_code == 415


async def test_slot_put_nothing_to_update(client, fake_redis, db):
    _, headers = await _setup(client, fake_redis, db, "slot-patch-03")
    svc = await create_service(client, headers)
    slot = await create_slot(client, headers, svc["id"])
    r = await client.patch(
        f"/api/slots/{slot['id']}",
        headers={**headers, "content-type": "application/merge-patch+json"},
        content=b"{}",
    )
    assert r.status_code == 400


async def test_slot_delete_happy_path(client, fake_redis, db):
    _, headers = await _setup(client, fake_redis, db, "slot-del-01")
    svc = await create_service(client, headers)
    slot = await create_slot(client, headers, svc["id"])
    r = await client.delete(f"/api/slots/{slot['id']}", headers=headers)
    assert r.status_code == 200
    assert r.json()["id"] == slot["id"]


async def test_slot_delete_with_booking_409(client, fake_redis, db):
    # Any booking row referencing the slot (confirmed or cancelled)
    # makes delete a terminal 409.
    import uuid as _uuid

    from countmein.db import client as db_client
    from sqlalchemy import text

    _, headers = await _setup(client, fake_redis, db, "slot-del-02")
    svc = await create_service(client, headers)
    slot = await create_slot(client, headers, svc["id"])
    import hashlib
    import secrets

    token = "tok-" + secrets.token_hex(16)
    async with db_client.engine().begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO bookings (id, time_slot_id, status, seats, guest_name, "
                "guest_messenger, guest_messenger_id, guest_locale, manage_token, "
                "manage_token_hash, manage_token_expires_at) VALUES ("
                ":bid, :slot, 'confirmed', 1, 'G', "
                "'telegram', 'slot-del-02', 'en', :token, "
                ":hash, now() + interval '1 day')"
            ),
            {
                "bid": str(_uuid.uuid4()),
                "slot": slot["id"],
                "token": token,
                "hash": hashlib.sha256(token.encode()).hexdigest(),
            },
        )
    r = await client.delete(f"/api/slots/{slot['id']}", headers=headers)
    assert r.status_code == 409
    assert body_json(r).get("error")
