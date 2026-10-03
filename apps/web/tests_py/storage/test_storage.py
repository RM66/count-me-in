"""The storage tests — the ownership boundary, key mapping, cleanup
skip decisions, and the signed-upload seam (the presign is computed
locally, no network)."""

from __future__ import annotations

from datetime import UTC, datetime

import countmein.storage as storage
import pytest


@pytest.fixture()
def r2_env(monkeypatch):
    """Full R2 env set (config() validates every name before returning)
    plus a cache reset so the env takes effect even when tests run
    together."""
    monkeypatch.setenv("R2_ACCOUNT_ID", "acc")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "key")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "secret")
    monkeypatch.setenv("R2_BUCKET", "bucket")
    monkeypatch.setenv("R2_PUBLIC_BASE_URL", "https://media.example.com")
    storage.reset_for_test()
    yield
    storage.reset_for_test()


ID = "org-123"
BASE = "https://media.example.com/organizers/" + ID


@pytest.mark.parametrize(
    "name,url,want",
    [
        ("exact directory", BASE, True),
        ("file inside directory", BASE + "/avatar.png", True),
        ("nested file", BASE + "/services/s1/photo.png", True),
        ("trailing slash stays inside", BASE + "/", True),
        (
            "sibling prefix must not match",
            "https://media.example.com/organizers/" + ID + "-evil/avatar.png",
            False,
        ),
        ("parent directory", "https://media.example.com/organizers/other/photo.png", False),
        ("traversal via dotdot", BASE + "/../other/photo.png", False),
        (
            "traversal encoded in path",
            "https://media.example.com/organizers/../other/photo.png",
            False,
        ),
        ("dot segment", BASE + "/./avatar.png", True),
        ("foreign host", "https://evil.example.com/organizers/" + ID + "/avatar.png", False),
        ("garbage url", "::::not-a-url", False),
    ],
)
def test_is_own_media_url(r2_env, name, url, want):
    assert storage.is_own_media_url(ID, url) is want


@pytest.mark.parametrize(
    "name,url,key,ok",
    [
        (
            "avatar",
            BASE + "/avatar-abcd1234.webp",
            "organizers/" + ID + "/avatar-abcd1234.webp",
            True,
        ),
        (
            "service cover",
            BASE + "/services/photo-abcd1234.png",
            "organizers/" + ID + "/services/photo-abcd1234.png",
            True,
        ),
        ("dot segments resolve", BASE + "/./avatar.png", "organizers/" + ID + "/avatar.png", True),
        (
            "query string ignored",
            BASE + "/avatar.png?v=123",
            "organizers/" + ID + "/avatar.png",
            True,
        ),
        ("directory itself is not an object", BASE, "", False),
        ("directory with slash is not an object", BASE + "/", "", False),
        ("foreign organizer", "https://media.example.com/organizers/other/avatar.png", "", False),
        ("foreign host", "https://evil.example.com/organizers/" + ID + "/avatar.png", "", False),
        ("garbage url", "::::not-a-url", "", False),
    ],
)
def test_media_key_from_url(r2_env, name, url, key, ok):
    got = storage.media_key_from_url(ID, url)
    assert (got is not None) is ok
    if ok:
        assert got == key


def test_media_key_from_url_with_base_path(monkeypatch):
    """A public base URL with its own path prefix (e.g. a /cdn mount)
    must round-trip: public_url prepends the prefix, media_key_from_url
    strips it."""
    monkeypatch.setenv("R2_ACCOUNT_ID", "acc")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "key")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "secret")
    monkeypatch.setenv("R2_BUCKET", "bucket")
    monkeypatch.setenv("R2_PUBLIC_BASE_URL", "https://cdn.example.com/media")
    storage.reset_for_test()
    try:
        key = storage.media_key_from_url(
            ID, f"https://cdn.example.com/media/organizers/{ID}/avatar.png"
        )
        assert key == f"organizers/{ID}/avatar.png"
        assert (
            storage.media_key_from_url(ID, f"https://cdn.example.com/media/organizers/{ID}") is None
        ), "the organizer directory itself must not map to a key"
    finally:
        storage.reset_for_test()


def test_media_key_round_trips_public_url(monkeypatch):
    """public_url and media_key_from_url must be exact inverses for the
    keys the upload paths generate — the cleanup depends on it."""
    monkeypatch.setenv("R2_ACCOUNT_ID", "acc")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "key")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "secret")
    monkeypatch.setenv("R2_BUCKET", "bucket")
    monkeypatch.setenv("R2_PUBLIC_BASE_URL", "https://cdn.example.com/media")
    storage.reset_for_test()
    try:
        for key in (storage.avatar_key(ID, "webp"), storage.service_photo_key(ID, "png")):
            url = storage.public_url(key)
            got = storage.media_key_from_url(ID, url)
            assert got == key, f"round trip {key} → {url} broke"
    finally:
        storage.reset_for_test()


def test_delete_replaced_media(r2_env, monkeypatch):
    """The skip decisions: nothing to delete, the same URL, the same
    object behind a different spelling, or foreign media. The delete
    seam records the calls, so a regression that reaches R2 fails here
    instead of in production."""
    deleted: list[str] = []

    def fake_delete(key):
        deleted.append(key)

    monkeypatch.setattr(storage, "_delete_object", fake_delete)

    skips = [
        ("nothing to delete", "", BASE + "/avatar.png"),
        ("unchanged url", BASE + "/avatar.png", BASE + "/avatar.png"),
        ("cache buster on the unchanged url", BASE + "/avatar.png?v=1", BASE + "/avatar.png?v=1"),
        ("same object behind a cache buster", BASE + "/avatar.png?v=1", BASE + "/avatar.png?v=2"),
        ("same object behind an encoded path", BASE + "/ava%74ar.png", BASE + "/avatar.png"),
        (
            "foreign host",
            "https://evil.example.com/organizers/" + ID + "/avatar.png",
            BASE + "/avatar.png",
        ),
        (
            "foreign organizer",
            "https://media.example.com/organizers/other/avatar.png",
            BASE + "/avatar.png",
        ),
        ("malformed url", "::::not-a-url", BASE + "/avatar.png"),
        ("directory is not an object", BASE, BASE + "/avatar.png"),
    ]
    for name, old_url, new_url in skips:
        storage.delete_replaced_media(ID, old_url, new_url)
        assert not deleted, f"{name}: must not delete, got {deleted}"

    storage.delete_replaced_media(
        ID, BASE + "/avatar-abcd1234.webp?v=9", BASE + "/services/photo-ffff.png"
    )
    assert deleted == ["organizers/" + ID + "/avatar-abcd1234.webp"], (
        "replaced avatar must be deleted by key"
    )


def test_delete_replaced_media_unconfigured_storage(monkeypatch):
    """Without the R2 env set the cleanup must report a storage error
    and never attempt the delete — the skip used to be logged as foreign
    media, which hid a misconfiguration."""
    for name in (
        "R2_ACCOUNT_ID",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET",
        "R2_PUBLIC_BASE_URL",
    ):
        monkeypatch.setenv(name, "")
    storage.reset_for_test()
    try:

        def no_delete(key):
            raise AssertionError("no delete attempt is possible without config")

        monkeypatch.setattr(storage, "_delete_object", no_delete)
        storage.delete_replaced_media(
            ID,
            f"https://media.example.com/organizers/{ID}/avatar.png",
            f"https://media.example.com/organizers/{ID}/avatar-2.png",
        )
    finally:
        storage.reset_for_test()


# ── Signed-upload seam ───────────────────────────────────────────────────────


def test_signed_upload_url_missing_env_is_error_not_panic(monkeypatch):
    for name in (
        "R2_ACCOUNT_ID",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET",
        "R2_PUBLIC_BASE_URL",
    ):
        monkeypatch.setenv(name, "")
    storage.reset_for_test()
    try:
        with pytest.raises(Exception, match="R2_"):
            storage.signed_upload_url("organizers/o1/avatar.png", "image/png", 1024)
    finally:
        storage.reset_for_test()


def test_signed_upload_url_shape(monkeypatch):
    monkeypatch.setenv("R2_ACCOUNT_ID", "test-account")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "test-key")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "test-secret")
    monkeypatch.setenv("R2_BUCKET", "test-bucket")
    monkeypatch.setenv("R2_PUBLIC_BASE_URL", "https://media.example.com")
    storage.reset_for_test()
    try:
        before = datetime.now(tz=UTC)
        url, expires_at = storage.signed_upload_url("organizers/o1/avatar.png", "image/webp", 2048)

        # Path-style R2 endpoint, the bucket and the key in the path.
        assert url.startswith(
            "https://test-account.r2.cloudflarestorage.com/test-bucket/organizers/o1/avatar.png"
        ), "want the R2 path-style endpoint with bucket and key"
        # The signature pins content type and length — the browser PUT
        # must match them exactly or R2 rejects it.
        assert "X-Amz-Signature=" in url, "upload URL must be signed"
        assert "X-Amz-Expires=600" in url, "upload URL must expire in 600s"
        # The returned expiry matches the 10-minute presign window.
        max_age = (expires_at - datetime.now(tz=UTC)).total_seconds()
        assert 0 < max_age <= 600 and expires_at >= before, "expiresAt must be ~now+10min"
    finally:
        storage.reset_for_test()


def test_delete_object_missing_env_is_error_not_panic(monkeypatch):
    for name in (
        "R2_ACCOUNT_ID",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET",
        "R2_PUBLIC_BASE_URL",
    ):
        monkeypatch.setenv(name, "")
    storage.reset_for_test()
    try:
        with pytest.raises(Exception, match="R2_"):
            storage.delete_object("organizers/o1/avatar.png")
    finally:
        storage.reset_for_test()


def test_delete_object_empty_key_is_error():
    """An empty key must be refused before config or a request: a
    bucket-level DELETE is never the intent of a cleanup."""
    with pytest.raises(Exception):
        storage.delete_object("")
