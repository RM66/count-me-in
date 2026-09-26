"""Port of pkg/queue/qstash_test.go — the after-commit publisher
(ADR-012). The booking is already committed when this runs, so failures
are signalled — never thrown — and the dedup id (the outbox row id) is
what makes the sweeper's re-publish safe."""

import _lib.countmein.queue as queue
import httpx
import pytest


class FakePost:
    """Records the publish request and answers with a canned status."""

    def __init__(self, status: int = 200):
        self.status = status
        self.calls: list[dict] = []

    def __call__(self, url, content=None, headers=None, timeout=None):
        self.calls.append(
            {
                "url": url,
                "content": content,
                "headers": dict(headers or {}),
                "timeout": timeout,
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


def test_publish_outbox_headers(fake_post, monkeypatch):
    _dev_env(monkeypatch)
    payload = b'{"bookingId":"01930000-0000-7000-8000-0000000000bb","recipient":"organizer"}'
    queue.publish_outbox("booking.created", payload, "row-id-1", "trace-1")
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


def test_publish_outbox_dev_skips_without_token(fake_post, monkeypatch):
    _dev_env(monkeypatch, QSTASH_TOKEN="")
    with pytest.raises(queue.PublishSkipped):
        queue.publish_outbox("booking.created", b"{}", "row-id", "trace")
    assert not fake_post.calls, "dev skip must not touch HTTP"


def test_publish_outbox_prod_requires_token(fake_post, monkeypatch):
    monkeypatch.setenv("QSTASH_TOKEN", "")
    monkeypatch.setenv("NODE_ENV", "production")
    with pytest.raises(RuntimeError, match="QSTASH_TOKEN"):
        queue.publish_outbox("booking.created", b"{}", "row-id", "trace")
    assert not fake_post.calls


def test_publish_outbox_unreachable_is_error(monkeypatch):
    monkeypatch.setattr(queue, "_post", httpx.post)
    try:
        _dev_env(monkeypatch, QSTASH_URL="http://127.0.0.1:1")  # refuses fast
        with pytest.raises(Exception):
            queue.publish_outbox("booking.created", b"{}", "row-id", "trace")
    finally:
        queue._reset_for_test()


def test_publish_outbox_non_2xx_is_error(fake_post, monkeypatch):
    fake_post.status = 500
    _dev_env(monkeypatch)
    with pytest.raises(RuntimeError, match="HTTP 500"):
        queue.publish_outbox("booking.created", b"{}", "row-id", "trace")


def test_publish_outbox_requires_app_url(fake_post, monkeypatch):
    _dev_env(monkeypatch, APP_URL="")
    with pytest.raises(RuntimeError, match="APP_URL"):
        queue.publish_outbox("booking.created", b"{}", "row-id", "trace")
    assert not fake_post.calls
