"""Port of pkg/auth/session_test.go — the HKDF golden vector (the
cross-language anchor with organizer-token.ts) and HS256 verification."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from _lib.countmein.auth.session import (
    ORGANIZER_AUTH_HEADER,
    derived_signing_key,
    session_from_request,
    verify_organizer_auth,
)
from starlette.requests import Request

TEST_SECRET = "test-golden-secret"


def mint_test_token(secret: str, sub: str, slug: str, exp: int) -> str:
    """Mint an HS256 organizer token with the same derivation as the
    production verifier (the derivation itself is pinned by the golden
    test below)."""
    header = (
        base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
        .rstrip(b"=")
        .decode()
    )
    payload = (
        base64.urlsafe_b64encode(
            json.dumps({"sub": sub, "slug": slug, "iat": int(time.time()), "exp": exp}).encode()
        )
        .rstrip(b"=")
        .decode()
    )
    signing_input = f"{header}.{payload}"
    sig = hmac.new(derived_signing_key(secret), signing_input.encode(), hashlib.sha256).digest()
    return f"{signing_input}.{base64.urlsafe_b64encode(sig).rstrip(b'=').decode()}"


def test_derived_signing_key_golden():
    """Pin the HKDF derivation to Node's crypto.hkdfSync('sha256',
    secret, 'countmein', 'CountMeIn Organizer API Token Key v1', 32) —
    the cross-language anchor. If this test fails after touching either
    side's derivation parameters, the TS and Python keys have drifted
    and every signed-in organizer silently becomes anonymous."""
    want = bytes.fromhex("6d1ed228ced7fcfff1fc563e2f14f95c2e542a579d0eb2896e27ee93d0dd4318")
    assert derived_signing_key(TEST_SECRET) == want


def test_verify_valid():
    token = mint_test_token(
        TEST_SECRET, "01930000-0000-7000-8000-000000000001", "studio", int(time.time()) + 60
    )
    claims = verify_organizer_auth(token, TEST_SECRET)
    assert claims is not None
    assert claims["sub"] == "01930000-0000-7000-8000-000000000001"
    assert claims["slug"] == "studio"


def test_verify_wrong_secret():
    token = mint_test_token(TEST_SECRET, "sub", "slug", int(time.time()) + 60)
    assert verify_organizer_auth(token, "another-secret") is None


def test_verify_expired():
    token = mint_test_token(TEST_SECRET, "sub", "slug", int(time.time()) - 3600)
    assert verify_organizer_auth(token, TEST_SECRET) is None


def test_verify_within_clock_tolerance():
    # 10s past expiry — within the 15s tolerance.
    token = mint_test_token(TEST_SECRET, "sub", "slug", int(time.time()) - 10)
    assert verify_organizer_auth(token, TEST_SECRET) is not None


def test_verify_garbage():
    for token in ("", "not-a-token", "a.b", "a.b.c.d", "a.b.c.x"):
        assert verify_organizer_auth(token, TEST_SECRET) is None, (
            f"garbage token {token!r} must not verify"
        )


def test_verify_wrong_alg():
    # Build a token with alg "none" — must be rejected.
    header = base64.urlsafe_b64encode(b'{"alg":"none","typ":"JWT"}').rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(b'{"sub":"x","exp":9999999999}').rstrip(b"=").decode()
    signing_input = f"{header}.{payload}"
    sig = hmac.new(
        derived_signing_key(TEST_SECRET), signing_input.encode(), hashlib.sha256
    ).digest()
    token = f"{signing_input}.{base64.urlsafe_b64encode(sig).rstrip(b'=').decode()}"
    assert verify_organizer_auth(token, TEST_SECRET) is None, "non-HS256 alg must be rejected"


def test_verify_empty_sub():
    token = mint_test_token(TEST_SECRET, "", "slug", int(time.time()) + 60)
    assert verify_organizer_auth(token, TEST_SECRET) is None


def _request(headers: dict[str, str] | None = None) -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/bookings",
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
        "query_string": b"",
    }
    return Request(scope)


def test_session_from_request_no_header(monkeypatch):
    monkeypatch.setenv("AUTH_SECRET", TEST_SECRET)
    assert session_from_request(_request()) is None, "request without header must return no session"


def test_session_from_request_valid_header(monkeypatch):
    monkeypatch.setenv("AUTH_SECRET", TEST_SECRET)
    token = mint_test_token(
        TEST_SECRET, "01930000-0000-7000-8000-0000000000ff", "yoga", int(time.time()) + 60
    )
    s = session_from_request(_request({ORGANIZER_AUTH_HEADER: token}))
    assert s is not None, "valid header must return a session"
    assert s.organizer_id == "01930000-0000-7000-8000-0000000000ff"
    assert s.slug == "yoga"


def test_session_from_request_no_secret(monkeypatch):
    monkeypatch.setenv("AUTH_SECRET", "")
    token = mint_test_token("whatever", "sub", "slug", int(time.time()) + 60)
    assert session_from_request(_request({ORGANIZER_AUTH_HEADER: token})) is None, (
        "missing AUTH_SECRET must return no session"
    )
