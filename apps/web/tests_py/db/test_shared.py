"""Pure unit tests for the data-layer
helpers (no Postgres needed)."""

from __future__ import annotations

import re

from countmein.db.shared import (
    new_id,
    new_manage_token,
    new_service_id,
)

NANOID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"


def test_new_service_id_shape():
    for _ in range(100):
        id_ = new_service_id()
        assert len(id_) == 21, f"nanoid length must be 21, got {len(id_)} ({id_!r})"
        for c in id_:
            assert c in NANOID_ALPHABET, f"nanoid charset violation: {id_!r}"


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
