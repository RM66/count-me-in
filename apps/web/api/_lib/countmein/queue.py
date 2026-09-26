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

import httpx

from . import config, logx

# ErrPublishSkipped — dev without QSTASH_TOKEN: the publish is
# deliberately never attempted (localhost is not routable from Upstash).
# Callers mark the row `skipped` (terminal, honest in metrics), not
# `sent`. A sentinel exception, not None, so the caller can tell
# "deliberately skipped" apart from "delivered".
PUBLISH_SKIPPED = "qstash publish skipped (dev without QSTASH_TOKEN)"


class PublishSkipped(Exception):
    """The sentinel for a deliberately skipped dev publish."""


# How hard QStash tries before dropping a message: 5 delivery attempts
# with exponential backoff. Permanent failures (recipient never pressed
# Start) are completed by the receiver with a 200, so they never spend
# this budget.
JOB_RETRIES = 5

DEFAULT_QSTASH_URL = "https://qstash.upstash.io"

# 1s, well under the caller's 1.5s after-commit publish budget: a hung
# QStash must fail fast into the sweeper path instead of being killed
# mid-request (the sweeper re-publishes the pending row).
_HTTP_TIMEOUT = 1.0


def publish_outbox(
    queue_name: str,
    payload: bytes | str,
    dedup_id: str,
    trace_id: str,
) -> None:
    """Publish one outbox row's payload to its queue. dedup_id (the
    outbox row id) is sent as Upstash-Deduplication-Id — QStash
    suppresses a redelivery of the same id, which makes the sweeper's
    at-least-once re-publish safe against the inline path and against
    its own retries. trace_id travels as Upstash-Trace-Id so the job
    handler can correlate the pipeline.

    In dev without QSTASH_TOKEN the publish is skipped by raising
    PublishSkipped — local deliveries would be unreachable anyway
    (QStash POSTs to APP_URL; localhost is not routable from Upstash),
    and the caller marks the row `skipped` so the sweeper does not churn
    on it and the metrics stay honest."""
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
    _publish_body(token, base, destination, queue_name, payload, dedup_id, trace_id)


def _publish_body(
    token: str,
    base: str,
    destination: str,
    queue_name: str,
    body: bytes | str,
    dedup_id: str,
    trace_id: str,
) -> None:
    """The shared HTTP POST to QStash's publish endpoint. dedup_id
    (outbox row id) and trace_id are forwarded as QStash headers —
    QStash forwards Upstash-* headers to the destination, so the job
    handler reads the trace id from the incoming request headers."""
    headers: dict[str, str] = {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        "Upstash-Retries": str(JOB_RETRIES),
    }
    if dedup_id != "":
        # Suppresses duplicate deliveries of the same outbox row — the
        # sweeper re-publish and QStash retries become no-ops instead of
        # duplicate Telegram messages.
        headers["Upstash-Deduplication-Id"] = dedup_id
    if trace_id != "":
        headers["Upstash-Trace-Id"] = trace_id
    try:
        res = _post(
            base + "/v2/publish/" + destination,
            content=body,
            headers=headers,
            timeout=_HTTP_TIMEOUT,
        )
    except httpx.HTTPError as err:
        raise err
    if res.status_code >= 300:
        raise RuntimeError(f"qstash publish {queue_name}: HTTP {res.status_code}")


def _destination(queue_name: str) -> str:
    """The QStash destination for a queue: this deployment's receiver
    route ({APP_URL}/api/jobs/{queue})."""
    app_url = os.getenv("APP_URL", "").rstrip("/")
    if app_url == "":
        raise RuntimeError("APP_URL is not set")
    return app_url + "/api/jobs/" + queue_name


# Test seam: the transport, so tests can pin headers without a network.
_post = httpx.post


def _reset_for_test() -> None:
    """Restore the default transport after a test patched it."""
    global _post
    _post = httpx.post
