"""The after-commit publisher (ADR-012). The booking is already
committed when this runs, so failures are signalled — never thrown —
and the dedup id (the outbox row id) makes the sweeper's re-publish
safe.

HTTP is mocked with respx at the httpx transport, so the tests pin the
real client call — URL, headers, payload bytes, timeout — without a
production-side seam.
"""

import asyncio

import countmein.queue as queue
import httpx
import pytest
import respx

PUBLISH_URL = "https://qstash.test/v2/publish/https://example.com/api/jobs/booking.created"


def _dev_env(monkeypatch, **extra):
    monkeypatch.setenv("QSTASH_TOKEN", "test-token")
    monkeypatch.setenv("QSTASH_URL", "https://qstash.test")
    monkeypatch.setenv("APP_URL", "https://example.com")
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("VERCEL_ENV", "")
    for k, v in extra.items():
        monkeypatch.setenv(k, v)


@respx.mock
async def test_publish_outbox_headers(monkeypatch):
    route = respx.post(PUBLISH_URL).mock(return_value=httpx.Response(200))
    _dev_env(monkeypatch)
    payload = b'{"bookingId":"01930000-0000-7000-8000-0000000000bb","recipient":"organizer"}'
    await queue.publish_outbox("booking.created", payload, "row-id-1", "trace-1")
    assert route.call_count == 1
    req = route.calls.last.request
    assert req.headers["Authorization"] == "Bearer test-token"
    assert req.headers["Upstash-Deduplication-Id"] == "row-id-1", (
        "dedup id must be the outbox row id"
    )
    assert req.headers["Upstash-Trace-Id"] == "trace-1"
    assert req.headers["Upstash-Retries"] == "5"
    assert req.content == payload, "the outbox payload must travel verbatim"
    timeout = req.extensions["timeout"]
    assert timeout["read"] == 1.0, "a hung QStash must fail fast into the sweeper path"


@respx.mock
async def test_publish_outbox_dev_skips_without_token(monkeypatch):
    route = respx.post(PUBLISH_URL).mock(return_value=httpx.Response(200))
    _dev_env(monkeypatch, QSTASH_TOKEN="")
    with pytest.raises(queue.PublishSkipped):
        await queue.publish_outbox("booking.created", b"{}", "row-id", "trace")
    assert route.call_count == 0, "dev skip must not touch HTTP"


@respx.mock
async def test_publish_outbox_prod_requires_token(monkeypatch):
    route = respx.post(PUBLISH_URL).mock(return_value=httpx.Response(200))
    monkeypatch.setenv("QSTASH_TOKEN", "")
    monkeypatch.setenv("NODE_ENV", "production")
    with pytest.raises(RuntimeError, match="QSTASH_TOKEN"):
        await queue.publish_outbox("booking.created", b"{}", "row-id", "trace")
    assert route.call_count == 0


async def test_publish_outbox_unreachable_is_error(monkeypatch):
    _dev_env(monkeypatch, QSTASH_URL="http://127.0.0.1:1")  # refuses fast
    with pytest.raises(Exception):
        await queue.publish_outbox("booking.created", b"{}", "row-id", "trace")


@respx.mock
async def test_publish_outbox_non_2xx_is_error(monkeypatch):
    respx.post(PUBLISH_URL).mock(return_value=httpx.Response(500))
    _dev_env(monkeypatch)
    with pytest.raises(RuntimeError, match="HTTP 500"):
        await queue.publish_outbox("booking.created", b"{}", "row-id", "trace")


@respx.mock
async def test_publish_outbox_requires_app_url(monkeypatch):
    route = respx.post(PUBLISH_URL).mock(return_value=httpx.Response(200))
    _dev_env(monkeypatch, APP_URL="")
    with pytest.raises(RuntimeError, match="APP_URL"):
        await queue.publish_outbox("booking.created", b"{}", "row-id", "trace")
    assert route.call_count == 0


@respx.mock
async def test_publish_outbox_budget_cancels_slow_publish(monkeypatch):
    """The 1500ms publish budget must actually be enforced: the transport
    is async, so asyncio.timeout cancels a hung publish instead of
    waiting out a response that never comes."""

    async def slow(request):
        await asyncio.sleep(3)
        return httpx.Response(200)

    respx.post(PUBLISH_URL).mock(side_effect=slow)
    _dev_env(monkeypatch)
    import time

    started = time.monotonic()
    from countmein.routes import bookings as bookings_route

    row = type(
        "Row", (), {"queue": "booking.created", "payload": b"{}", "id": "r1", "trace_id": ""}
    )()
    await asyncio.wait_for(bookings_route.publish_outbox_rows([row], "trace-slow"), timeout=2.0)
    elapsed = time.monotonic() - started
    assert elapsed < 1.9, f"the publish budget must cut a slow publish short ({elapsed:.2f}s)"
