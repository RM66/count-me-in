"""The receiver tests — the signature is produced with the same
primitives the Upstash side uses (HS256 JWT, signing key as raw secret,
body claim = base64url SHA-256), hand-built here so the test anchors
the wire contract instead of the implementation. Verification itself is
delegated to the official `qstash` Receiver primitives."""

import base64
import hashlib
import hmac
import json
import time

import pytest
from countmein.jobs import receiver

# Keys are ≥32 bytes: the qstash SDK warns on shorter signing keys
# (InsecureKeyLengthWarning) and production keys are long.
CURRENT_KEY = "sig-current-key-000000000000000000000000"
NEXT_KEY = "sig-next-key-0000000000000000000000000000"
TEST_SUB = "https://countmein.group/api/jobs/booking.created"


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def sign_qstash(key: str, body: str, claims: dict | None = None) -> str:
    claims = dict(claims or {})
    claims["iss"] = "Upstash"
    claims.setdefault("exp", int(time.time()) + 3600)
    claims.setdefault("nbf", int(time.time()) - 60)
    claims.setdefault("sub", TEST_SUB)
    claims["body"] = _b64url(hashlib.sha256(body.encode()).digest())
    return sign_with_claims(claims, key)


def sign_with_claims(claims: dict, key: str) -> str:
    claims.setdefault("iss", "Upstash")
    header = _b64url(b'{"alg":"HS256","typ":"JWT"}')
    payload_b64 = _b64url(json.dumps(claims).encode())
    mac = hmac.new(key.encode(), f"{header}.{payload_b64}".encode(), hashlib.sha256).digest()
    return f"{header}.{payload_b64}.{_b64url(mac)}"


def test_verify_current_key():
    sig = sign_qstash(CURRENT_KEY, '{"bookingId":"x"}')
    assert receiver.verify_qstash_signature(
        b'{"bookingId":"x"}', sig, CURRENT_KEY, NEXT_KEY, TEST_SUB
    )


def test_verify_rotation():
    # Rotated keys: current no longer matches, next must.
    sig = sign_qstash(NEXT_KEY, '{"bookingId":"x"}')
    assert receiver.verify_qstash_signature(
        b'{"bookingId":"x"}', sig, CURRENT_KEY, NEXT_KEY, TEST_SUB
    )
    # And it must NOT verify as if it were signed by current.
    assert not receiver.verify_qstash_signature(
        b'{"bookingId":"x"}', sig, CURRENT_KEY, "unrelated-key-000000000000000000", TEST_SUB
    )


def test_verify_body_mismatch():
    sig = sign_qstash(CURRENT_KEY, '{"bookingId":"a"}')
    assert not receiver.verify_qstash_signature(
        b'{"bookingId":"b"}', sig, CURRENT_KEY, NEXT_KEY, TEST_SUB
    )


def test_verify_expired():
    sig = sign_qstash(CURRENT_KEY, "body", {"exp": int(time.time()) - 3600})
    assert not receiver.verify_qstash_signature(b"body", sig, CURRENT_KEY, NEXT_KEY, TEST_SUB), (
        "expired signature must fail (past the 60s clock tolerance)"
    )


def test_verify_wrong_issuer():
    sig = sign_with_claims(
        {
            "iss": "Someone Else",
            "exp": int(time.time()) + 3600,
            "nbf": int(time.time()) - 60,
            "sub": TEST_SUB,
            "body": _b64url(hashlib.sha256(b"body").digest()),
        },
        CURRENT_KEY,
    )
    assert not receiver.verify_qstash_signature(b"body", sig, CURRENT_KEY, NEXT_KEY, TEST_SUB)


def test_verify_wrong_sub():
    # The sub claim binds the token to one destination queue; a token
    # minted for another queue must not verify here.
    sig = sign_qstash(
        CURRENT_KEY, "body", {"sub": "https://countmein.group/api/jobs/booking.cancelled"}
    )
    assert not receiver.verify_qstash_signature(b"body", sig, CURRENT_KEY, NEXT_KEY, TEST_SUB)


@pytest.mark.parametrize("sig", ["", "not-a-jwt", "a.b", "a.b.c.d"])
def test_verify_garbage(sig):
    assert not receiver.verify_qstash_signature(b"body", sig, CURRENT_KEY, NEXT_KEY, TEST_SUB)


def test_verify_padded_body_claim():
    # The claim may arrive with "=" padding; comparison strips it on
    # both sides (parity with the TS Receiver).
    padded = base64.urlsafe_b64encode(hashlib.sha256(b"body").digest()).decode("ascii")
    sig = sign_with_claims(
        {
            "exp": int(time.time()) + 3600,
            "nbf": int(time.time()) - 60,
            "sub": TEST_SUB,
            "body": padded,
        },
        CURRENT_KEY,
    )
    assert receiver.verify_qstash_signature(b"body", sig, CURRENT_KEY, NEXT_KEY, TEST_SUB)


def test_empty_next_key_is_not_a_valid_key():
    # A token signed with "" as the secret is computable by anyone;
    # an empty next key must be skipped, not tried.
    sig = sign_qstash("", '{"bookingId":"x"}')
    assert not receiver.verify_qstash_signature(
        b'{"bookingId":"x"}', sig, CURRENT_KEY, "", TEST_SUB
    )


def test_token_without_exp_rejected():
    # No exp claim: a captured delivery must not replay forever.
    sig = sign_with_claims(
        {
            "iss": "Upstash",
            "nbf": int(time.time()) - 60,
            "sub": TEST_SUB,
            "body": _b64url(hashlib.sha256(b"body").digest()),
        },
        CURRENT_KEY,
    )
    assert not receiver.verify_qstash_signature(b"body", sig, CURRENT_KEY, NEXT_KEY, TEST_SUB)


def test_non_utf8_body_rejected():
    # QStash only delivers JSON, so non-UTF-8 bytes are not a body we
    # signed. The SDK re-encodes the body string with strict UTF-8, so
    # a lenient decode would crash inside it (UnicodeEncodeError → 500,
    # burning QStash's retry budget). Must fail verification (401).
    sig = sign_qstash(CURRENT_KEY, "body")
    assert not receiver.verify_qstash_signature(b"bo\xffdy", sig, CURRENT_KEY, NEXT_KEY, TEST_SUB)


def test_non_string_body_claim_rejected():
    # A validly-signed token whose body claim is not a string: the SDK
    # calls .rstrip on it and raises AttributeError — same rule as the
    # missing claim, fail verification (401), not crash the route (500).
    sig = sign_with_claims(
        {
            "iss": "Upstash",
            "exp": int(time.time()) + 3600,
            "nbf": int(time.time()) - 60,
            "sub": TEST_SUB,
            "body": 12345,
        },
        CURRENT_KEY,
    )
    assert not receiver.verify_qstash_signature(b"body", sig, CURRENT_KEY, NEXT_KEY, TEST_SUB)


def test_both_keys_empty_rejected():
    sig = sign_qstash(CURRENT_KEY, '{"bookingId":"x"}')
    assert not receiver.verify_qstash_signature(b'{"bookingId":"x"}', sig, "", "", TEST_SUB)


def test_token_without_body_claim_rejected():
    # A validly-signed token missing the body claim: the SDK raises
    # KeyError on claims["body"] — that must fail verification (401),
    # not crash the route (500, which would burn QStash's retry budget).
    sig = sign_with_claims(
        {
            "iss": "Upstash",
            "exp": int(time.time()) + 3600,
            "nbf": int(time.time()) - 60,
            "sub": TEST_SUB,
        },
        CURRENT_KEY,
    )
    assert not receiver.verify_qstash_signature(b"body", sig, CURRENT_KEY, NEXT_KEY, TEST_SUB)


def test_trace_id_from_headers():
    assert receiver.trace_id_from_headers({"Upstash-Trace-Id": "t-1"}) == "t-1"
    assert receiver.trace_id_from_headers({"upstash-trace-id": "t-2"}) == "t-2"
    assert receiver.trace_id_from_headers({}) == ""
