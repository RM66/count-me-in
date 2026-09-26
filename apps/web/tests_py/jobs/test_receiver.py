"""Port of pkg/jobs/receiver_test.go — the signature is produced with
the same primitives jose uses on the Upstash side (HS256 JWT, signing
key as raw secret, body claim = base64url SHA-256), hand-built here so
the test anchors the wire contract instead of the implementation."""

import base64
import hashlib
import hmac
import json
import time

import pytest
from _lib.countmein.jobs import receiver

CURRENT_KEY = "sig-current-key-0000000000000000"
NEXT_KEY = "sig-next-key-0000000000000000000000"
TEST_SUB = "https://countmein.group/api/jobs/booking.created"


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def sign_qstash(key: str, body: str, claims: dict | None = None) -> str:
    claims = dict(claims or {})
    claims["iss"] = "Upstash"
    claims.setdefault("exp", int(time.time()) + 3600)
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
        b'{"bookingId":"x"}', sig, CURRENT_KEY, "unrelated", TEST_SUB
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
        {"exp": int(time.time()) + 3600, "sub": TEST_SUB, "body": padded},
        CURRENT_KEY,
    )
    assert receiver.verify_qstash_signature(b"body", sig, CURRENT_KEY, NEXT_KEY, TEST_SUB)


def test_trace_id_from_headers():
    assert receiver.trace_id_from_headers({"Upstash-Trace-Id": "t-1"}) == "t-1"
    assert receiver.trace_id_from_headers({"upstash-trace-id": "t-2"}) == "t-2"
    assert receiver.trace_id_from_headers({}) == ""
