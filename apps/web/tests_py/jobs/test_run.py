"""Job dispatch semantics. The route's status codes are QStash's retry
budget (ADR-012): a malformed payload is a 400-class
InvalidJobPayloadError (no retry — QStash would re-send the same bad
bytes), an unknown queue a 404-class UnknownJobQueueError, and
TelegramUnreachableError is absorbed (a recipient who never pressed
Start can never be messaged — retrying burns the budget).

The idempotency tests run against fakeredis."""

import countmein.jobs.run as run
import pytest
from countmein import redis as redis_mod
from countmein.contracts.constants_gen import (
    QUEUE_BOOKING_CANCELLED,
    QUEUE_BOOKING_CREATED,
    QUEUE_DEMO_REFRESH,
    QUEUE_OUTBOX_SWEEP,
)
from countmein.jobs.telegram import (
    TelegramTransientError,
    TelegramUnreachableError,
)

TEST_BOOKING_ID = "01930000-0000-7000-8000-0000000000bb"


@pytest.fixture()
def fakeredis(monkeypatch):
    import fakeredis.aioredis

    fake = fakeredis.aioredis.FakeRedis()
    monkeypatch.setattr(redis_mod, "client", lambda: fake)
    monkeypatch.setenv("REDIS_URL", "redis://fake")
    yield fake


async def test_run_job_unknown_queue():
    with pytest.raises(run.UnknownJobQueueError) as exc:
        await run.run_job("some.foreign.queue", None, "")
    assert exc.value.queue == "some.foreign.queue"


@pytest.mark.parametrize(
    "name,body",
    [
        ("empty body", ""),
        ("broken json", '{"bookingId":'),
        ("empty object (missing fields)", "{}"),
        ("non-uuid bookingId", '{"bookingId":"not-a-uuid","recipient":"organizer"}'),
        ("unknown recipient", f'{{"bookingId":"{TEST_BOOKING_ID}","recipient":"nobody"}}'),
        ("missing recipient", f'{{"bookingId":"{TEST_BOOKING_ID}"}}'),
    ],
)
async def test_run_job_booking_created_invalid_payloads(name, body):
    with pytest.raises(run.InvalidJobPayloadError):
        await run.run_job(QUEUE_BOOKING_CREATED, body.encode() or None, "")


@pytest.mark.parametrize(
    "name,body",
    [
        ("empty body", ""),
        ("broken json", '{"bookingId":'),
        ("non-uuid bookingId", '{"bookingId":"nope","cancelledBy":"guest"}'),
        ("unknown cancelledBy", f'{{"bookingId":"{TEST_BOOKING_ID}","cancelledBy":"system"}}'),
        ("missing cancelledBy", f'{{"bookingId":"{TEST_BOOKING_ID}"}}'),
    ],
)
async def test_run_job_booking_cancelled_invalid_payloads(name, body):
    with pytest.raises(run.InvalidJobPayloadError):
        await run.run_job(QUEUE_BOOKING_CANCELLED, body.encode() or None, "")


async def test_run_job_valid_payload_reaches_env_check(monkeypatch):
    """A well-formed payload passes parse + shape validation and reaches
    the env check — the raised error is the env error, NOT
    InvalidJobPayloadError. This pins the boundary: payload problems are
    400-class, configuration problems are 500-class (QStash retries)."""
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "")
    monkeypatch.setenv("APP_URL", "")

    with pytest.raises(RuntimeError, match="jobs env is not configured"):
        await run.run_job(
            QUEUE_BOOKING_CREATED,
            f'{{"bookingId":"{TEST_BOOKING_ID}","recipient":"organizer",'
            f'"outboxId":"01930000-0000-7000-8000-0000000000cc"}}'.encode(),
            "",
        )
    with pytest.raises(RuntimeError, match="jobs env is not configured"):
        await run.run_job(
            QUEUE_BOOKING_CANCELLED,
            f'{{"bookingId":"{TEST_BOOKING_ID}","cancelledBy":"guest",'
            f'"outboxId":"01930000-0000-7000-8000-0000000000cc"}}'.encode(),
            "",
        )


async def test_parse_job_schedule_queues_accept_empty_body():
    for queue in (QUEUE_DEMO_REFRESH, QUEUE_OUTBOX_SWEEP):
        for body in (None, b"{}", b'{"anything":1}'):
            run.parse_job(queue, body)  # must not raise
    for queue in (QUEUE_BOOKING_CREATED, QUEUE_BOOKING_CANCELLED):
        with pytest.raises(run.InvalidJobPayloadError):
            run.parse_job(queue, None)


def test_parse_job_unknown_queue():
    with pytest.raises(run.UnknownJobQueueError):
        run.parse_job("some.foreign.queue", None)


# ── with_retry_policy ────────────────────────────────────────────────────────


async def test_with_retry_policy_absorbs_unreachable():
    async def fail():
        raise TelegramUnreachableError("123", "Forbidden: bot was blocked by the user")

    await run._with_retry_policy(QUEUE_BOOKING_CREATED, "trace-1", fail)


async def test_with_retry_policy_propagates_transient():
    transient = TelegramTransientError("Telegram 429: Too Many Requests")

    async def fail_transient():
        raise transient

    with pytest.raises(TelegramTransientError):
        await run._with_retry_policy(QUEUE_BOOKING_CREATED, "trace-2", fail_transient)

    plain = RuntimeError("some handler failure")

    async def fail_plain():
        raise plain

    with pytest.raises(RuntimeError):
        await run._with_retry_policy(QUEUE_BOOKING_CREATED, "trace-3", fail_plain)


async def test_with_retry_policy_success():
    async def ok():
        return None

    await run._with_retry_policy(QUEUE_BOOKING_CREATED, "trace-4", ok)


# ── consumer idempotency ─────────────────────────────────────────────────────
#
# The claim suppresses duplicate deliveries; a retryable failure must
# release it, or every QStash retry (and sweeper re-publish) of a row
# whose first send failed would be answered as a duplicate and the
# notification would be lost while the outbox row looked delivered.


async def test_run_claimed_releases_claim_on_retryable_failure(fakeredis):
    outbox_id = "01930000-0000-7000-8000-0000000000c1"
    calls = 0

    async def fail():
        nonlocal calls
        calls += 1
        raise TelegramTransientError("Telegram 429: Too Many Requests")

    with pytest.raises(TelegramTransientError):
        await run.run_claimed(QUEUE_BOOKING_CREATED, "trace-idem-1", outbox_id, fail)
    assert calls == 1, "first delivery must reach the handler"

    # The retry must be processed, not suppressed: the failed attempt
    # released the claim.
    async def succeed():
        nonlocal calls
        calls += 1

    await run.run_claimed(QUEUE_BOOKING_CREATED, "trace-idem-1", outbox_id, succeed)
    assert calls == 2, "a retryable failure must release the claim"


async def test_run_claimed_suppresses_duplicate_after_success(fakeredis):
    outbox_id = "01930000-0000-7000-8000-0000000000c2"
    calls = 0

    async def send():
        nonlocal calls
        calls += 1

    await run.run_claimed(QUEUE_BOOKING_CREATED, "trace-idem-2", outbox_id, send)
    # A second delivery of the same outbox row (sweeper re-publish after
    # a successful send + failed mark-sent) completes without sending.
    await run.run_claimed(QUEUE_BOOKING_CREATED, "trace-idem-2", outbox_id, send)
    assert calls == 1, "duplicate delivery must not send again"


async def test_run_claimed_keeps_claim_on_absorbed_terminal_error(fakeredis):
    outbox_id = "01930000-0000-7000-8000-0000000000c3"
    calls = 0

    async def unreachable():
        nonlocal calls
        calls += 1
        raise TelegramUnreachableError("123", "Forbidden: bot was blocked by the user")

    # _with_retry_policy absorbs the terminal error — the delivery is
    # complete, so the claim stays and a redelivery is a no-op.
    await run.run_claimed(QUEUE_BOOKING_CREATED, "trace-idem-3", outbox_id, unreachable)
    await run.run_claimed(QUEUE_BOOKING_CREATED, "trace-idem-3", outbox_id, unreachable)
    assert calls == 1, "terminal outcome must keep the claim"


async def test_claim_is_a_short_lease_finalized_to_full_ttl(fakeredis):
    """The crash-window invariant (ADR-021): the claim TTL is a short
    lease (60s — the send window), so an instance killed mid-send
    leaves the key to expire and the retry is processed, not
    suppressed. A successful send finalizes the claim to the full 24h
    idempotency TTL, so replays are suppressed for the retention
    window."""
    outbox_id = "01930000-0000-7000-8000-0000000000c4"
    key = "job:processed:" + outbox_id

    async def ok():
        return None

    assert await run.claim_delivery(outbox_id) is True
    ttl = await fakeredis.ttl(key)
    assert 0 < ttl <= 60, "claim must be a short lease, not the full TTL"

    await run.finalize_delivery(outbox_id)
    ttl = await fakeredis.ttl(key)
    assert 60 < ttl <= 24 * 3600, "finalize must extend to the full idempotency TTL"


# ── payload shape helpers ─────────────────────────────────────────────────────


def test_parse_job_booking_created_missing_outbox_id():
    """outboxId is the consumer idempotency key — a payload without it
    is malformed (400), not accepted-then-crashing. Pinned by the spec:
    BookingCreatedJob marks it required."""
    body = f'{{"bookingId":"{TEST_BOOKING_ID}","recipient":"organizer"}}'.encode()
    with pytest.raises(run.InvalidJobPayloadError):
        run.parse_job(QUEUE_BOOKING_CREATED, body)


def test_parse_job_rejects_non_canonical_uuid():
    """The spec UUID pattern is stricter than uuid.UUID(): urn: and
    braced forms must fail validation as a 400, not reach Postgres
    and surface as a retried 500."""
    body = (
        b'{"bookingId":"urn:uuid:' + TEST_BOOKING_ID.encode() + b'",'
        b'"recipient":"organizer","outboxId":"' + TEST_BOOKING_ID.encode() + b'"}'
    )
    with pytest.raises(run.InvalidJobPayloadError):
        run.parse_job(QUEUE_BOOKING_CREATED, body)


def test_parse_job_valid_payload_constructs_model():
    body = (
        f'{{"bookingId":"{TEST_BOOKING_ID}","recipient":"organizer",'
        f'"outboxId":"01930000-0000-7000-8000-0000000000cc"}}'
    ).encode()
    created = run.parse_job(QUEUE_BOOKING_CREATED, body)
    assert created is not None
    assert str(created.bookingId) == TEST_BOOKING_ID
    assert created.recipient == "organizer"
