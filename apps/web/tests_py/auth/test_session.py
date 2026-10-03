"""The HKDF golden vector (the cross-language anchor with
organizer-token.ts) and HS256 verification."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from countmein.auth.session import (
    ORGANIZER_AUTH_HEADER,
    derived_signing_key,
    session_from_request,
    verify_organizer_auth,
)
from starlette.requests import Request

TEST_SECRET = "test-golden-secret"


def mint_test_token(secret: str, sub: str, slug: str, exp: int) -> str:
    """Mint an HS256 organizer token with the production derivation
    (itself pinned by the golden test below)."""
    header = (
        base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
        .rstrip(b"=")
        .decode()
    )
    payload = (
        base64.urlsafe_b64encode(
            json.dumps(
                {
                    "iss": "countmein-web",
                    "aud": "countmein-api",
                    "sub": sub,
                    "slug": slug,
                    "iat": int(time.time()),
                    "exp": exp,
                }
            ).encode()
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
    the cross-language anchor. A drift means every signed-in organizer
    silently becomes anonymous."""
    want = bytes.fromhex("6d1ed228ced7fcfff1fc563e2f14f95c2e542a579d0eb2896e27ee93d0dd4318")
    assert derived_signing_key(TEST_SECRET) == want


def test_derived_internal_secret_golden():
    """Pin the internal-service derivation to the TS twin
    (src/server/internal-api.ts): HMAC-SHA256, salt 'countmein', info
    'CountMeIn Internal Service Key v1'. A drift means Next.js's
    x-internal-secret is refused — SSR reads fall back to the public
    rate bucket and revalidation answers 401."""
    from countmein.auth.internal import derived_internal_secret

    assert (
        derived_internal_secret("test-auth-secret")
        == "73b1b535eb4ded0b2f67951c5f9baf63b26be71360d8401d8a49d2a24c1dd106"
    )


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


def test_verify_non_ascii_signature_is_not_a_500():
    """A non-ASCII byte in the signature segment must fail verification
    cleanly (None), not raise: hmac.compare_digest on str raises
    TypeError on non-ASCII — a crafted X-Organizer-Auth header would
    otherwise surface as a 500."""
    token = mint_test_token(
        TEST_SECRET, "01930000-0000-7000-8000-000000000001", "studio", int(time.time()) + 60
    )
    header, payload, _sig = token.split(".")
    forged = f"{header}.{payload}.подпись-не-ascii"
    assert verify_organizer_auth(forged, TEST_SECRET) is None
    # And through the request path too — the header value is raw str.
    import os

    from starlette.requests import Request

    saved = os.environ.get("AUTH_SECRET")
    os.environ["AUTH_SECRET"] = TEST_SECRET
    try:
        scope = {
            "type": "http",
            "method": "GET",
            "path": "/api/organizers/me",
            "headers": [(ORGANIZER_AUTH_HEADER.encode(), forged.encode())],
            "query_string": b"",
        }
        assert session_from_request(Request(scope)) is None
    finally:
        if saved is None:
            os.environ.pop("AUTH_SECRET", None)
        else:
            os.environ["AUTH_SECRET"] = saved


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


def test_non_numeric_exp_is_anonymous():
    """A non-int exp claim is a malformed/forged token — must be treated
    as an invalid session (anonymous), never a TypeError → 500."""
    token = mint_test_token(TEST_SECRET, "org-1", "slug", int(time.time()) + 60)
    # Re-sign with a string exp.
    header, payload, _ = token.split(".")
    claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    claims["exp"] = "not-a-number"
    new_payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=").decode()
    signing_input = f"{header}.{new_payload}"
    sig = hmac.new(
        derived_signing_key(TEST_SECRET), signing_input.encode(), hashlib.sha256
    ).digest()
    forged = f"{signing_input}.{base64.urlsafe_b64encode(sig).rstrip(b'=').decode()}"
    assert verify_organizer_auth(forged, TEST_SECRET) is None


def test_verify_empty_sub():
    token = mint_test_token(TEST_SECRET, "", "slug", int(time.time()) + 60)
    assert verify_organizer_auth(token, TEST_SECRET) is None


def test_verify_requires_iss_aud():
    """ADR-024: a token without the matching iss/aud pair is not an
    organizer-auth credential — replaying a token minted for another
    purpose under the same AUTH_SECRET must fail."""
    token = mint_test_token(TEST_SECRET, "sub", "slug", int(time.time()) + 60)
    header, payload, _sig = token.split(".")
    claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))

    def resign(c):
        p = base64.urlsafe_b64encode(json.dumps(c).encode()).rstrip(b"=").decode()
        si = f"{header}.{p}"
        s = hmac.new(derived_signing_key(TEST_SECRET), si.encode(), hashlib.sha256).digest()
        return f"{si}.{base64.urlsafe_b64encode(s).rstrip(b'=').decode()}"

    for drop in ("iss", "aud"):
        c = dict(claims)
        del c[drop]
        assert verify_organizer_auth(resign(c), TEST_SECRET) is None, (
            f"missing {drop} must not verify"
        )
    for claim, bad in (("iss", "other-issuer"), ("aud", "other-audience")):
        c = dict(claims)
        c[claim] = bad
        assert verify_organizer_auth(resign(c), TEST_SECRET) is None, (
            f"wrong {claim} must not verify"
        )


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
