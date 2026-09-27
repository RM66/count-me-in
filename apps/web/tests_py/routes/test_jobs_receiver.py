"""The QStash receiver's status semantics are the queue's retry
budget (ADR-012): 400 for a malformed
payload (no retry), 404 for a foreign queue, 401 for a bad signature,
500 for a handler failure (retry). The signature helper mirrorshand-built so the test anchors the wire
contract."""

import base64
import hashlib
import hmac
import json
import os
import time
from collections.abc import Mapping

import _lib.countmein.routes.jobs as jobs_route
import pytest
from _lib.countmein.contracts.constants_gen import QUEUE_BOOKING_CREATED as QUEUE_CREATED

ROUTES_CURRENT_KEY = "routes-sig-current-key-000000000000000"
ROUTES_NEXT_KEY = "routes-sig-next-key-000000000000000000000"


def sign_qstash(key: str, body: str, sub: str) -> str:
    claims = {
        "iss": "Upstash",
        "exp": int(time.time()) + 3600,
        "nbf": int(time.time()) - 60,
        "sub": sub,
        "body": base64.urlsafe_b64encode(hashlib.sha256(body.encode()).digest())
        .rstrip(b"=")
        .decode(),
    }
    header = base64.urlsafe_b64encode(b'{"alg":"HS256","typ":"JWT"}').rstrip(b"=").decode()
    payload_b64 = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=").decode()
    mac = hmac.new(key.encode(), f"{header}.{payload_b64}".encode(), hashlib.sha256).digest()
    return f"{header}.{payload_b64}." + base64.urlsafe_b64encode(mac).rstrip(b"=").decode()


def expected_sub(queue: str) -> str:
    """Mirrors the receiver: APP_URL (trimmed) + "/api/jobs/" + queue.
    Tests leave APP_URL unset, so the sub is the bare path."""
    return os.getenv("APP_URL", "").rstrip("/") + "/api/jobs/" + queue


def make_request(path: str, body: bytes, headers: Mapping[str, str]):
    from starlette.requests import Request

    scope = {
        "type": "http",
        "method": "POST",
        "path": path,
        "raw_path": path.encode(),
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        "query_string": b"",
        "client": ("127.0.0.1", 12345),
        "scheme": "http",
        "server": ("testserver", 80),
        "http_version": "1.1",
    }
    request = Request(scope)
    request._body = body
    return request


@pytest.fixture(autouse=True)
def _no_redis(monkeypatch):
    """The replay cache must fail open to "not seen": no REDIS_URL, no
    Redis client — the tests exercise the signature/payload doors, not
    the cache."""
    monkeypatch.delenv("REDIS_URL", raising=False)


@pytest.fixture(autouse=True)
def _signing_keys(monkeypatch):
    monkeypatch.setenv("QSTASH_CURRENT_SIGNING_KEY", ROUTES_CURRENT_KEY)
    monkeypatch.setenv("QSTASH_NEXT_SIGNING_KEY", ROUTES_NEXT_KEY)


async def post_jobs(queue: str, body: str, signature: str):
    headers = {}
    if signature:
        headers["upstash-signature"] = signature
    request = make_request("/api/jobs/" + queue, body.encode(), headers)
    response = await jobs_route.jobs_receiver(request, queue)
    return response


async def test_jobs_receiver_signing_keys_not_set(monkeypatch):
    monkeypatch.setenv("QSTASH_CURRENT_SIGNING_KEY", "")
    monkeypatch.setenv("QSTASH_NEXT_SIGNING_KEY", "")
    request = make_request("/api/jobs/booking.created", b"", {})
    response = await jobs_route.jobs_receiver(request, QUEUE_CREATED)
    assert response.status_code == 500


async def test_jobs_receiver_missing_signature():
    response = await post_jobs(QUEUE_CREATED, "{}", "")
    assert response.status_code == 401


async def test_jobs_receiver_bad_signature():
    response = await post_jobs(QUEUE_CREATED, "{}", "not-a-jwt")
    assert response.status_code == 401
    sig = sign_qstash("wrong-key", "{}", expected_sub(QUEUE_CREATED))
    response = await post_jobs(QUEUE_CREATED, "{}", sig)
    assert response.status_code == 401


async def test_jobs_receiver_unknown_queue():
    body = '{"x":1}'
    sig = sign_qstash(ROUTES_CURRENT_KEY, body, expected_sub("some.foreign.queue"))
    response = await post_jobs("some.foreign.queue", body, sig)
    assert response.status_code == 404


async def test_jobs_receiver_invalid_payload():
    # Valid signature, invalid payload → 400, QStash does not retry.
    body = '{"bookingId":"not-a-uuid"}'
    sig = sign_qstash(ROUTES_CURRENT_KEY, body, expected_sub(QUEUE_CREATED))
    response = await post_jobs(QUEUE_CREATED, body, sig)
    assert response.status_code == 400


async def test_jobs_receiver_invalid_json():
    body = '{"bookingId":'
    sig = sign_qstash(ROUTES_CURRENT_KEY, body, expected_sub(QUEUE_CREATED))
    response = await post_jobs(QUEUE_CREATED, body, sig)
    assert response.status_code == 400


async def test_jobs_receiver_handler_failure_is_500(monkeypatch):
    # A well-formed booking.created payload reaches the handler; with
    # the job env unconfigured the handler fails → 500, which is what
    # makes QStash retry (the opposite of the 400 above).
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "")
    monkeypatch.setenv("APP_URL", "")
    body = '{"bookingId":"01930000-0000-7000-8000-0000000000bb","recipient":"organizer"}'
    sig = sign_qstash(ROUTES_CURRENT_KEY, body, expected_sub(QUEUE_CREATED))
    response = await post_jobs(QUEUE_CREATED, body, sig)
    assert response.status_code == 500


async def test_jobs_receiver_empty_body_is_not_json():
    # An empty body is valid for the schedule queues; for booking
    # queues it must still be a 400 — but the signature check runs on
    # the raw bytes, so sign the empty body.
    sig = sign_qstash(ROUTES_CURRENT_KEY, "", expected_sub(QUEUE_CREATED))
    response = await post_jobs(QUEUE_CREATED, "", sig)
    assert response.status_code == 400
