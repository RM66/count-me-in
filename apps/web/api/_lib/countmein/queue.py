"""Publish jobs to Upstash QStash after the booking transaction commits
(ADR-012). Publishing is an HTTPS call, so it cannot join the Postgres
transaction; the contract is publish-after-commit, QStash owns delivery
from there (at-least-once, 5 retries with exponential backoff).

Every publish goes through the transactional outbox row written in the
booking transaction: the row id is sent as Upstash-Deduplication-Id, so a
race between the inline publish and the sweeper — or a QStash retry —
cannot deliver the same notification twice. The caller marks the row
`sent` after a successful POST.
"""

from __future__ import annotations

import os
from typing import Any

import httpx

from . import config, logx
from .web.async_client import client as async_client

# Dev without QSTASH_TOKEN: the publish is never attempted (localhost
# is not routable from Upstash); callers mark the row `skipped`, not
# `sent`. A sentinel exception, not None, tells "skipped" from
# "delivered".
PUBLISH_SKIPPED = "qstash publish skipped (dev without QSTASH_TOKEN)"


class PublishSkipped(Exception):
    """The sentinel for a deliberately skipped dev publish."""


# Delivery attempts before QStash drops a message. Permanent failures
# (recipient never pressed Start) are completed with a 200, so they
# never spend this budget.
JOB_RETRIES = 5

DEFAULT_QSTASH_URL = "https://qstash.upstash.io"

# Well under the caller's 1.5s publish budget: a hung QStash fails fast
# into the sweeper path instead of being killed mid-request.
_HTTP_TIMEOUT = 1.0


async def publish_outbox(
    queue_name: str,
    payload: bytes | str,
    dedup_id: str,
    trace_id: str,
) -> None:
    """Publish one outbox row's payload to its queue. dedup_id (the row
    id) goes as Upstash-Deduplication-Id — QStash suppresses a
    redelivery, making the sweeper's at-least-once re-publish safe.
    trace_id travels as Upstash-Trace-Id for the job handler.

    Dev without QSTASH_TOKEN raises PublishSkipped — local deliveries
    are unreachable anyway — and the caller marks the row `skipped`."""
    token = os.getenv("QSTASH_TOKEN", "")
    if token == "":
        if config.is_production():
            raise RuntimeError("QSTASH_TOKEN is not set")
        logx.warn_every(
            5 * 60,
            "QSTASH_TOKEN is not set — skipping notification publish (dev only)",
            None,
        )
        raise PublishSkipped(PUBLISH_SKIPPED)
    base = os.getenv("QSTASH_URL", "").rstrip("/")
    if base == "":
        base = DEFAULT_QSTASH_URL
    destination = _destination(queue_name)
    await _publish_body(token, base, destination, queue_name, payload, dedup_id, trace_id)


async def _publish_body(
    token: str,
    base: str,
    destination: str,
    queue_name: str,
    body: bytes | str,
    dedup_id: str,
    trace_id: str,
) -> None:
    """Shared HTTP POST to QStash's publish endpoint. dedup_id and
    trace_id go as QStash headers — Upstash-* headers are forwarded to
    the destination, so the job handler reads the trace id from the
    incoming request."""
    headers: dict[str, str] = {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        "Upstash-Retries": str(JOB_RETRIES),
    }
    if dedup_id != "":
        # Suppresses duplicate deliveries of the same row — sweeper
        # re-publish and retries become no-ops, not duplicate messages.
        headers["Upstash-Deduplication-Id"] = dedup_id
    if trace_id != "":
        headers["Upstash-Trace-Id"] = trace_id
    # A transport error propagates as httpx.HTTPError — callers leave
    # the row pending for the sweeper.
    res = await _post(
        base + "/v2/publish/" + destination,
        content=body,
        headers=headers,
        timeout=_HTTP_TIMEOUT,
    )
    if res.status_code >= 300:
        raise RuntimeError(f"qstash publish {queue_name}: HTTP {res.status_code}")


def _destination(queue_name: str) -> str:
    """The QStash destination for a queue: {APP_URL}/api/jobs/{queue}."""
    app_url = os.getenv("APP_URL", "").rstrip("/")
    if app_url == "":
        raise RuntimeError("APP_URL is not set")
    return app_url + "/api/jobs/" + queue_name


async def _default_post(url: str, **kwargs: Any) -> httpx.Response:
    return await async_client().post(url, **kwargs)


# Test seam: the transport — async so the caller's asyncio.timeout can
# actually cancel it.
_post = _default_post


def _reset_for_test() -> None:
    """Restore the default transport after a test patched it."""
    global _post
    _post = _default_post
