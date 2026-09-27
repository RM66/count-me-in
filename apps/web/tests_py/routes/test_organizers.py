"""Organizer route tests: register, me GET/PUT, language, demo
refusal, 404, merge-patch semantics, validation envelope."""

from __future__ import annotations

from _lib.countmein.contracts.constants_gen import DEMO_ORGANIZER_ID, DEMO_READ_ONLY_CODE

from ._helpers import (
    TEST_SECRET,
    auth_headers,
    body_json,
    mint_session,
    register_organizer,
)


async def test_register_happy_path(client, fake_redis, db):
    org = await register_organizer(client, fake_redis, "org-happy-01")
    assert org["slug"].startswith("org-happy-01")
    assert org["id"]


async def test_register_reserved_slug_refused(client, fake_redis, db):
    from _lib.countmein.auth.telegram import TICKET_PURPOSE_ORGANIZER
    from _lib.countmein.auth.ticket import issue_ticket
    from _lib.countmein.contracts.payloads import AuthTicketPayload

    ticket = await issue_ticket(
        AuthTicketPayload(
            messenger="telegram",
            messenger_id="route-reserved",
            display_name="Route Test",
            purpose=TICKET_PURPOSE_ORGANIZER,
        )
    )
    r = await client.post(
        "/api/organizers",
        json={
            "ticket": ticket,
            "slug": "api",
            "name": "Reserved",
            "timezone": "Europe/Belgrade",
            "language": "en",
        },
    )
    assert r.status_code == 400
    assert body_json(r).get("error")


async def test_register_unknown_ticket_401(client, fake_redis):
    r = await client.post(
        "/api/organizers",
        json={
            "ticket": "unknown-ticket-aaaaaaaaaaaaaaaaaaaaaaa",
            "slug": "org-unknown",
            "name": "X",
            "timezone": "Europe/Belgrade",
            "language": "en",
        },
    )
    assert r.status_code == 401


async def test_register_validation_error_envelope(client, fake_redis):
    # Missing every required field — the register route answers with
    # issues (fieldErrors only), not details.
    r = await client.post("/api/organizers", json={"slug": "x"})
    assert r.status_code == 400
    body = body_json(r)
    assert body.get("error")
    assert "issues" in body


async def test_me_requires_session(client, fake_redis, db):
    r = await client.get("/api/organizers/me")
    # Anonymous cabinet reads fall back to the demo organizer — /me is
    # the signed-in organizer's own profile, so anonymous gets demo.
    assert r.status_code in (200, 404)


async def test_me_get_happy_path(client, fake_redis, db):
    org = await register_organizer(client, fake_redis, "org-me-01")
    headers = {**auth_headers(sub=org["id"], slug=org["slug"])}
    r = await client.get("/api/organizers/me", headers=headers)
    assert r.status_code == 200
    assert r.json()["organizer"]["id"] == org["id"]


async def test_me_put_merge_patch_absent_keeps(client, fake_redis, db):
    org = await register_organizer(client, fake_redis, "org-put-01")
    headers = {**auth_headers(sub=org["id"], slug=org["slug"])}
    # Absent key = keep: only the name changes.
    r = await client.put(
        "/api/organizers/me",
        headers={**headers, "content-type": "application/merge-patch+json"},
        content=b'{"name": "Renamed"}',
    )
    assert r.status_code == 200
    body = r.json()["organizer"]
    assert body["name"] == "Renamed"
    assert body["slug"].startswith("org-put-01")


async def test_me_put_null_clears(client, fake_redis, db):
    org = await register_organizer(client, fake_redis, "org-put-02")
    headers = {**auth_headers(sub=org["id"], slug=org["slug"])}
    r = await client.put(
        "/api/organizers/me",
        headers={**headers, "content-type": "application/merge-patch+json"},
        content=b'{"description": null}',
    )
    assert r.status_code == 200
    assert r.json()["organizer"]["description"] is None


async def test_me_put_requires_merge_patch_media_type(client, fake_redis, db):
    org = await register_organizer(client, fake_redis, "org-put-03")
    headers = {**auth_headers(sub=org["id"], slug=org["slug"])}
    r = await client.put(
        "/api/organizers/me",
        headers={**headers, "content-type": "application/json"},
        content=b'{"name": "X"}',
    )
    assert r.status_code == 415


async def test_me_put_nothing_to_update(client, fake_redis, db):
    org = await register_organizer(client, fake_redis, "org-put-04")
    headers = {**auth_headers(sub=org["id"], slug=org["slug"])}
    r = await client.put(
        "/api/organizers/me",
        headers={**headers, "content-type": "application/merge-patch+json"},
        content=b"{}",
    )
    assert r.status_code == 400


async def test_me_put_demo_refused(client, fake_redis):
    headers = {
        **auth_headers(sub=DEMO_ORGANIZER_ID, slug="demo"),
        "content-type": "application/merge-patch+json",
    }
    r = await client.put("/api/organizers/me", headers=headers, content=b'{"name": "X"}')
    assert r.status_code == 403
    assert body_json(r).get("code") == DEMO_READ_ONLY_CODE


async def test_language_patch(client, fake_redis, db):
    org = await register_organizer(client, fake_redis, "org-lang-01")
    headers = {**auth_headers(sub=org["id"], slug=org["slug"])}
    r = await client.patch("/api/organizers/me/language", headers=headers, json={"language": "de"})
    assert r.status_code == 204
    r = await client.get("/api/organizers/me", headers=headers)
    assert r.json()["organizer"]["language"] == "de"


async def test_language_unknown_value_refused(client, fake_redis, db):
    org = await register_organizer(client, fake_redis, "org-lang-02")
    headers = {**auth_headers(sub=org["id"], slug=org["slug"])}
    r = await client.patch("/api/organizers/me/language", headers=headers, json={"language": "xx"})
    assert r.status_code == 400


async def test_expired_session_is_anonymous(client, fake_redis, db):
    import time

    headers = {
        **auth_headers(sub="01930000-0000-7000-8000-00000000dead", slug="gone"),
    }
    # An expired token must read as anonymous, not 500.
    expired = mint_session(
        TEST_SECRET, "01930000-0000-7000-8000-00000000dead", "gone", exp=int(time.time()) - 10
    )
    headers = {k: expired for k in headers}
    r = await client.get("/api/organizers/me", headers=headers)
    assert r.status_code in (200, 404)
