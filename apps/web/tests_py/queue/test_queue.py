"""The after-commit publisher (ADR-012). The booking is already
committed when this runs, so failures are signalled — never thrown —
and the dedup id (the outbox row id) makes the sweeper's re-publish
safe."""

import asyncio

import countmein.queue as queue
import httpx
import pytest


class FakePost:
    """Records the publish request and answers with a canned status."""

    def __init__(self, status: int = 200):
        self.status = status
        self.calls: list[dict] = []

    async def __call__(self, url, content=None, headers=None, **kwargs):
        self.calls.append(
            {
                "url": url,
                "content": content,
                "headers": dict(headers or {}),
                "timeout": kwargs.get("timeout"),
            }
        )
        return httpx.Response(self.status, request=httpx.Request("POST", url))


@pytest.fixture()
def fake_post(monkeypatch):
    fake = FakePost()
    monkeypatch.setattr(queue, "_post", fake)
    yield fake
    queue._reset_for_test()


def _dev_env(monkeypatch, **extra):
    monkeypatch.setenv("QSTASH_TOKEN", "test-token")
    monkeypatch.setenv("QSTASH_URL", "https://qstash.test")
    monkeypatch.setenv("APP_URL", "https://example.com")
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("VERCEL_ENV", "")
    for k, v in extra.items():
        monkeypatch.setenv(k, v)


async def test_publish_outbox_headers(fake_post, monkeypatch):
    _dev_env(monkeypatch)
    payload = b'{"bookingId":"01930000-0000-7000-8000-0000000000bb","recipient":"organizer"}'
    await queue.publish_outbox("booking.created", payload, "row-id-1", "trace-1")
    assert len(fake_post.calls) == 1
    call = fake_post.calls[0]
    assert call["headers"]["Authorization"] == "Bearer test-token"
    assert call["headers"]["Upstash-Deduplication-Id"] == "row-id-1", (
        "dedup id must be the outbox row id"
    )
    assert call["headers"]["Upstash-Trace-Id"] == "trace-1"
    assert call["headers"]["Upstash-Retries"] == "5"
    assert call["content"] == payload, "the outbox payload must travel verbatim"
    assert (
        call["url"] == "https://qstash.test/v2/publish/https://example.com/api/jobs/booking.created"
    )
    assert call["timeout"] == 1.0, "a hung QStash must fail fast into the sweeper path"


async def test_publish_outbox_dev_skips_without_token(fake_post, monkeypatch):
    _dev_env(monkeypatch, QSTASH_TOKEN="")
    with pytest.raises(queue.PublishSkipped):
        await queue.publish_outbox("booking.created", b"{}", "row-id", "trace")
    assert not fake_post.calls, "dev skip must not touch HTTP"


async def test_publish_outbox_prod_requires_token(fake_post, monkeypatch):
    monkeypatch.setenv("QSTASH_TOKEN", "")
    monkeypatch.setenv("NODE_ENV", "production")
    with pytest.raises(RuntimeError, match="QSTASH_TOKEN"):
        await queue.publish_outbox("booking.created", b"{}", "row-id", "trace")
    assert not fake_post.calls


async def test_publish_outbox_unreachable_is_error(monkeypatch):
    monkeypatch.setattr(queue, "_post", queue._default_post)
    try:
        _dev_env(monkeypatch, QSTASH_URL="http://127.0.0.1:1")  # refuses fast
        with pytest.raises(Exception):
            await queue.publish_outbox("booking.created", b"{}", "row-id", "trace")
    finally:
        queue._reset_for_test()


async def test_publish_outbox_non_2xx_is_error(fake_post, monkeypatch):
    fake_post.status = 500
    _dev_env(monkeypatch)
    with pytest.raises(RuntimeError, match="HTTP 500"):
        await queue.publish_outbox("booking.created", b"{}", "row-id", "trace")


async def test_publish_outbox_requires_app_url(fake_post, monkeypatch):
    _dev_env(monkeypatch, APP_URL="")
    with pytest.raises(RuntimeError, match="APP_URL"):
        await queue.publish_outbox("booking.created", b"{}", "row-id", "trace")
    assert not fake_post.calls


async def test_publish_outbox_budget_cancels_slow_publish(monkeypatch):
    """The 1500ms publish budget must actually be enforced: the transport
    is async, so asyncio.timeout cancels a hung publish instead of
    waiting out a thread that cannot be cancelled."""

    async def slow_post(url, content=None, headers=None, **kwargs):
        await asyncio.sleep(3)
        return httpx.Response(200, request=httpx.Request("POST", url))

    monkeypatch.setattr(queue, "_post", slow_post)
    _dev_env(monkeypatch)
    import time

    started = time.monotonic()
    from countmein.routes import bookings as bookings_route

    row = type("Row", (), {"queue": "booking.created", "payload": b"{}", "id": "r1"})()
    await asyncio.wait_for(bookings_route.publish_outbox_rows([row], "trace-slow"), timeout=2.0)
    elapsed = time.monotonic() - started
    assert elapsed < 1.9, f"the publish budget must cut a slow publish short ({elapsed:.2f}s)"
