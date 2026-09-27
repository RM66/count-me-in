"""Pure unit tests for the data-layer
helpers (no Postgres needed)."""

from __future__ import annotations

import re

from _lib.countmein.db.shared import (
    hash_manage_token,
    new_id,
    new_manage_token,
    new_service_id,
    parse_string_array,
)

NANOID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"


def test_parse_string_array():
    assert parse_string_array(None) is None
    assert parse_string_array("null") is None
    got = parse_string_array('["a","b c","d"]')
    assert got == ["a", "b c", "d"]
    assert parse_string_array("[]") == []


def test_new_service_id_shape():
    for _ in range(100):
        id_ = new_service_id()
        assert len(id_) == 21, f"nanoid length must be 21, got {len(id_)} ({id_!r})"
        for c in id_:
            assert c in NANOID_ALPHABET, f"nanoid charset violation: {id_!r}"


def test_hash_manage_token_parity():
    """The same SHA-256 hex as the TS helper (@repo/contracts/
    manage-token) and the SQL lookup key — pinned on both sides of the
    wire (manage-token.test.ts carries the same table)."""
    cases = [
        (
            "countmein-parity-vector",
            "fdacba0aa4450ff1b8a7a6c94795723794dc2987dac5bb0b2f81f6cadfd9f7a4",
        ),
        ("", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
        ("0123456789", "84d89877f0d4041efb6bf91a16f0248f2fd573e6af05c19f96bedb9f882f7882"),
        ("токен-🔑-парity", "af5cd9735dddab01d8c050b125086b0e655cdbb63c2b462d4f7fa1090cb606c0"),
        ("A" * 64, "d53eda7a637c99cc7fb566d96e9fa109bf15c478410a3f5eb4d4c4e26cd081f6"),
        ("A" * 256, "e075f2f51cad23d0537186cfcd50f911ea954f9c2e32a437f45327f1b7899bbb"),
    ]
    for token, want in cases:
        assert hash_manage_token(token) == want, f"hash mismatch for {token!r}"


def test_new_manage_token_shape():
    token = new_manage_token()
    # 32 bytes → 43 base64url chars (never typed by hand).
    assert len(token) == 43, f"manageToken must be 43 chars, got {len(token)} ({token!r})"
    assert "+" not in token and "/" not in token, f"manageToken must be URL-safe: {token!r}"


def test_new_id_shape():
    """uuidv7: version nibble 7, variant bits 10xx, monotonic-ish
    timestamps."""
    ids = [new_id() for _ in range(10)]
    for id_ in ids:
        assert re.fullmatch(
            r"[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
            id_,
        ), f"not a uuidv7: {id_}"
    assert len(set(ids)) == len(ids)
