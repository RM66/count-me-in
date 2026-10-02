"""The invariant index: one named test per AGENTS.md
"Conventions" rule.

This file is the auditable checklist, not the coverage. Most entries
delegate to the module tests that own the behavior (the delegation is
asserted — a renamed or deleted delegate fails here, so the index
cannot rot); a few invariants that have no single owning test are
pinned directly.

Run with `uv run pytest tests_py/test_invariants.py -v` for the audit
view; the delegated tests run in their own modules during the full
suite.
"""

from __future__ import annotations

import inspect
from pathlib import Path

TESTS = Path(__file__).resolve().parent


def _assert_test_exists(module_rel: str, test_name: str) -> None:
    """The delegated test must exist by name in the named module — the
    index references stay verifiable instead of rotting into comments."""
    import importlib

    module = importlib.import_module(module_rel)
    assert hasattr(module, test_name), (
        f"invariant delegate missing: {module_rel}::{test_name} — the index "
        "must be repointed when a test is renamed"
    )


# ── Seats move only through the atomic reserve ────────────────────────────────


def test_seat_reserve_is_single_conditional_update():
    """Invariant: seats are claimed by ONE conditional UPDATE inside the
    booking transaction — never read booked_count, check in Python,
    write back. Pinned two ways: the SQLAlchemy predicate in the
    repository, and the contention test that proves no overbooking
    under a race."""
    src = (TESTS.parent / "api/_lib/countmein/repositories/booking_repo.py").read_text("utf-8")
    # update(TimeSlot).where(id == ..., booked_count + seats <=
    # capacity).values(booked_count=booked_count + seats).returning():
    # the claim and the guard are one statement, and the updated row
    # comes back from the same round-trip (no re-read to race with).
    assert "TimeSlot.booked_count + seats <= TimeSlot.capacity" in src
    assert "booked_count=TimeSlot.booked_count+seats" in src.replace(" ", "")
    assert ".returning(TimeSlot)" in src
    # The predicate and the update must live in the same function —
    # a comment mentioning the shape must not satisfy the pin.
    reserve_fn = src.split("async def atomic_reserve_seats", 1)[1].split("\nasync def ", 1)[0]
    assert "TimeSlot.booked_count + seats <= TimeSlot.capacity" in reserve_fn
    assert ".returning(TimeSlot)" in reserve_fn
    # The read-check-write shape must not appear in the write path: a
    # SELECT of booked_count feeding a plain UPDATE is the bug this
    # invariant forbids. The shrink-capacity precheck in services/slot_service.py
    # reads booked_count under FOR UPDATE but never writes it — allow
    # that file, forbid the pattern in the booking write path.
    writes = (TESTS.parent / "api/_lib/countmein/services/booking_service.py").read_text("utf-8")
    assert "time_slots SET booked_count" not in writes
    assert "SET booked_count = :seats" not in writes.replace(
        "booked_count = booked_count + :seats", ""
    )
    assert "atomic_reserve_seats" in writes
    # Cancel releases through the status-guarded mark + release pair —
    # a double cancel must hit AlreadyCancelled, never double-decrement.
    assert "cancel_booking_mark" in writes
    assert "Booking.status == BookingStatus.CONFIRMED" in src
    _assert_test_exists(
        "tests_py.services.test_booking_writes", "test_create_guest_booking_concurrent_last_seats"
    )


def test_cancel_releases_seats_and_is_idempotent():
    """Invariant: cancel moves the booking to cancelled and releases the
    seats exactly once — a double-tap must not double-decrement."""
    _assert_test_exists(
        "tests_py.services.test_booking_writes", "test_cancel_guest_booking_idempotent"
    )


# ── Demo organizer is read-only ───────────────────────────────────────────────


def test_demo_organizer_rejected_on_every_write():
    """Invariant: every write path rejects the demo organizer id —
    guest booking, cancel, cabinet CRUD, direct service calls — and
    notifications are never sent for it. The guard's own semantics
    (UUID normalization, empty id, exact slug match) are pinned in
    isolation by tests_py.demo.test_guard."""
    _assert_test_exists(
        "tests_py.services.test_booking_writes", "test_create_guest_booking_demo_refused"
    )
    _assert_test_exists(
        "tests_py.services.test_booking_writes", "test_cancel_owned_booking_demo_refused"
    )
    _assert_test_exists(
        "tests_py.services.test_booking_writes", "test_service_layer_refuses_demo_writes"
    )
    _assert_test_exists(
        "tests_py.routes.test_bookings", "test_booking_cancel_by_organizer_demo_session"
    )
    _assert_test_exists("tests_py.jobs.test_handlers", "test_handle_booking_demo_refused")
    _assert_test_exists("tests_py.demo.test_guard", "test_is_demo_organizer_raw_uuid_object")
    _assert_test_exists(
        "tests_py.demo.test_guard", "test_refuse_demo_write_raises_on_demo_and_empty"
    )


def test_anonymous_cabinet_visitor_cannot_write():
    """Invariant: /cabinet requires no session, so an anonymous visitor
    is a demo-cabinet visitor — writes are refused, not 401-but-allowed."""
    _assert_test_exists(
        "tests_py.routes.test_bookings", "test_booking_cancel_by_organizer_anonymous"
    )


# ── Guest identity is a consumed ticket ───────────────────────────────────────


def test_guest_ticket_replay_fails():
    """Invariant: guest identity enters a write only through a
    single-use consumed ticket (GETDEL) — a replayed booking fails, and
    a raw client-supplied messengerId never authenticates."""
    _assert_test_exists("tests_py.auth.test_ticket", "test_issue_peek_consume_ticket")
    _assert_test_exists(
        "tests_py.routes.test_bookings", "test_booking_create_raw_messenger_id_ignored"
    )


def test_guest_ticket_purpose_is_enforced():
    """Invariant: a ticket minted for organizer signup is not
    redeemable in the booking flow."""
    _assert_test_exists(
        "tests_py.web.test_guards", "test_require_guest_identity_signup_purpose_refused"
    )


# ── Notifications: after commit, idempotent, absorbed ─────────────────────────


def test_notification_failure_never_fails_booking():
    """Invariant: the QStash publish runs after the DB commit and
    absorbs its own errors — a notification must never fail a
    committed booking."""
    _assert_test_exists(
        "tests_py.routes.test_bookings", "test_publish_outbox_rows_absorbs_publish_errors"
    )


def test_duplicate_outbox_delivery_not_resent():
    """Invariant: the job payload's outboxId is the consumer
    idempotency key — a duplicate delivery completes without sending,
    and a retryable failure releases the claim so the retry is
    processed (at-least-once, duplicates suppressed on success)."""
    _assert_test_exists(
        "tests_py.jobs.test_run", "test_run_claimed_suppresses_duplicate_after_success"
    )
    _assert_test_exists(
        "tests_py.jobs.test_run", "test_run_claimed_releases_claim_on_retryable_failure"
    )


def test_unreachable_recipient_completes_delivery():
    """Invariant: a Telegram bot may only message users who pressed
    Start — 403/chat-not-found completes the delivery instead of
    retrying; only 429/5xx/network are retried."""
    _assert_test_exists("tests_py.jobs.test_telegram", "test_send_message_unreachable_is_terminal")
    _assert_test_exists("tests_py.jobs.test_run", "test_with_retry_policy_absorbs_unreachable")


def test_jobs_receiver_verifies_signature_before_anything():
    """Invariant: the upstash-signature is verified before the payload
    is parsed or the handler runs; 500 makes QStash retry, 400/404 do
    not."""
    _assert_test_exists(
        "tests_py.routes.test_jobs_receiver", "test_jobs_receiver_missing_signature"
    )
    _assert_test_exists("tests_py.routes.test_jobs_receiver", "test_jobs_receiver_bad_signature")
    _assert_test_exists(
        "tests_py.routes.test_jobs_receiver", "test_jobs_receiver_handler_failure_is_500"
    )


def test_qstash_empty_key_forgery_rejected():
    """Invariant: an empty signing key is never tried — HMAC-SHA256
    with "" is computable by anyone, so a token forged with the empty
    next key must not verify (and a token without exp must not replay
    forever)."""
    _assert_test_exists("tests_py.jobs.test_receiver", "test_empty_next_key_is_not_a_valid_key")
    _assert_test_exists("tests_py.jobs.test_receiver", "test_token_without_exp_rejected")
    _assert_test_exists("tests_py.jobs.test_receiver", "test_both_keys_empty_rejected")


# ── manageToken: hashed credential, expiry, canCancel ─────────────────────────


def test_manage_token_hash_is_the_only_lookup_key():
    """Invariant: every credential check goes through the SHA-256 hash
    (parity with the TS helper, pinned by a shared vector); the raw
    column is not a lookup key."""
    _assert_test_exists("tests_py.db.test_shared", "test_hash_manage_token_parity")
    _assert_test_exists(
        "tests_py.services.test_booking_writes", "test_cancel_guest_booking_unknown_token"
    )


def test_expired_manage_token_refused_on_read_and_cancel():
    """Invariant: tokens expire at slot start + 24h grace; expired is
    refused on cancel, and the guest DTO's canCancel (the shared rule)
    keeps the history listed without offering the dead link."""
    _assert_test_exists(
        "tests_py.services.test_booking_writes", "test_cancel_guest_booking_expired_token"
    )
    _assert_test_exists(
        "tests_py.jobs.test_demo_refresh", "test_expired_booking_stays_listed_with_can_cancel_false"
    )


# ── Delete guards ─────────────────────────────────────────────────────────────


def test_delete_slot_with_cancelled_booking_is_409():
    """Invariant: deleting a slot/service is refused (409) as soon as
    any booking row references it — confirmed or cancelled; a stray
    23503 maps to the same 409, never a 500."""
    _assert_test_exists(
        "tests_py.services.test_booking_writes", "test_delete_owned_slot_refuses_cancelled_bookings"
    )
    _assert_test_exists(
        "tests_py.services.test_booking_writes", "test_delete_owned_service_refuses_bookings"
    )


# ── Rate limiting & proxy trust ───────────────────────────────────────────────


def test_rate_limiter_fails_open():
    """Invariant: the limiter fails open on a Redis outage (ADR-019) —
    an observability outage must never block traffic."""
    _assert_test_exists("tests_py.web.test_ratelimit", "test_allow_fails_open_on_redis_error")


def test_forwarded_for_ignored_without_trust():
    """Invariant: X-Forwarded-For is honored only on Vercel or with
    TRUST_PROXY_HEADERS=1 — otherwise a spoofed header cannot rotate
    rate-limit keys."""
    _assert_test_exists("tests_py.web.test_ratelimit", "test_client_ip_untrusted_forwarded_for")
    _assert_test_exists("tests_py.web.test_ratelimit", "test_client_ip_trusted_forwarded_for")


# ── Media cleanup ─────────────────────────────────────────────────────────────


def test_replaced_media_cleanup_is_best_effort_and_referenced():
    """Invariant: the old R2 object is deleted only if it is the
    organizer's own media, no row references it (prefix check), and
    old/new resolve to different keys; failures are logged, never fail
    the request."""
    _assert_test_exists("tests_py.storage.test_storage", "test_delete_replaced_media")
    _assert_test_exists("tests_py.services.test_booking_writes", "test_photo_url_referenced")


# ── Login links ───────────────────────────────────────────────────────────────


def test_login_links_are_single_use_and_safe():
    """Invariant: organizer deep links are one-time (GETDEL), consumed
    on POST only, and `next` is a relative cabinet path — no open
    redirect."""
    _assert_test_exists("tests_py.auth.test_ticket", "test_login_link_round_trip")
    _assert_test_exists("tests_py.auth.test_ticket", "test_login_link_rejects_absolute_next")


# ── Wire contract ─────────────────────────────────────────────────────────────


def test_route_set_equals_spec():
    """Invariant: the app's (method, path) set equals the Zod-owned
    OpenAPI spec — /api/healthz is the one deliberate exception."""
    _assert_test_exists("tests_py.test_route_set", "test_route_set_equals_spec")


def test_merge_patch_pair_rule_both_directions():
    """Invariant: the three partial-update endpoints speak RFC 7386
    (absent = keep, null = clear), and the options/optionsSelectMode
    pair is patched together in both directions."""
    _assert_test_exists("tests_py.routes.test_mergepatch", "test_merge_patch_clears_options_pair")
    _assert_test_exists("tests_py.routes.test_mergepatch", "test_merge_patch_keeps_absent_keys")


def test_body_bound_is_1mb():
    """Invariant: request bodies are bounded at 1MB → 413 (a truncated
    body must not surface as a confusing 400), refused incrementally —
    a huge body is never buffered whole first."""
    _assert_test_exists("tests_py.web.test_guards", "test_read_body_or_413")
    _assert_test_exists("tests_py.web.test_guards", "test_body_over_1mb_rejected_without_full_read")


def test_validation_error_does_not_consume_guest_ticket():
    """Invariant: the guest ticket is consumed only after the body
    validates (dependency order) — a validation failure must not
    burn the single-use credential."""
    _assert_test_exists(
        "tests_py.routes.test_bookings", "test_validation_error_does_not_consume_guest_ticket"
    )


# ── Env & cold start ──────────────────────────────────────────────────────────


def test_production_env_validation_is_loud():
    """Invariant: config validation fails the production cold start on
    missing connection/QStash/Telegram vars and a malformed APP_URL;
    STRICT_ENV=1 opts any environment in."""
    _assert_test_exists("tests_py.config.test_config", "test_validate_production_refusals")
    _assert_test_exists("tests_py.config.test_config", "test_validate_strict_env_opts_in")


def test_cold_import_stays_lean():
    """Invariant: importing the app must not pull boto3/qstash or open
    network connections — the cold-start budget is a product feature."""
    _assert_test_exists("tests_py.test_cold_imports", "test_cold_import_avoids_boto3")
    _assert_test_exists("tests_py.test_cold_imports", "test_cold_import_avoids_qstash")
    _assert_test_exists(
        "tests_py.test_cold_imports", "test_cold_import_opens_no_network_connection"
    )


# ── i18n ─────────────────────────────────────────────────────────────────────


def test_api_errors_are_localized():
    """Invariant: API error copy is localized per request (ApiErrors
    dictionaries); error classes keep EN messages for logs."""
    _assert_test_exists("tests_py.web.test_errors", "test_booking_error_response_localized")
    _assert_test_exists("tests_py.i18n.test_i18n", "test_every_locale_has_api_errors")


# ── Parity ────────────────────────────────────────────────────────────────────


def test_http_behavior_matches_parity_goldens():
    """Invariant: every parity scenario replays against the Python app
    and matches the golden transcript (re-recorded from the Python app
    itself — tests_py/parity/record.py is the regenerator)."""
    _assert_test_exists("tests_py.parity.test_replay", "test_replay_matches_golden")


# ── healthz & skipped status ──────────────────────────────────────────────────


def test_healthz_recovers_own_panics_and_names_missing_env():
    """Invariant: the healthz probe recovers its own errors — a missing
    connection env answers a JSON 503 naming the variables, never a
    connection reset; the probe is IP-rate-limited and fails open."""
    _assert_test_exists(
        "tests_py.routes.test_healthz", "test_healthz_probe_panic_answers_503_with_missing_env"
    )
    _assert_test_exists("tests_py.routes.test_healthz", "test_healthz_healthy_answers_200")
    _assert_test_exists("tests_py.routes.test_healthz", "test_healthz_rate_limited")


def test_dev_without_qstash_token_marks_rows_skipped():
    """Invariant: dev without QSTASH_TOKEN marks outbox rows `skipped`
    (terminal, honest in the backlog metrics), not `sent` — and
    production without the token is a hard error."""
    _assert_test_exists("tests_py.queue.test_queue", "test_publish_outbox_dev_skips_without_token")
    _assert_test_exists("tests_py.queue.test_queue", "test_publish_outbox_prod_requires_token")


def test_booking_created_fans_out_one_job_per_recipient():
    """Invariant: booking.created fans out to one job per recipient
    (organizer + guest), each carrying ids only — the handler refetches
    at send time."""
    _assert_test_exists(
        "tests_py.services.test_booking_writes", "test_create_guest_booking_success"
    )
    _assert_test_exists("tests_py.jobs.test_handlers", "test_handle_booking_created_per_recipient")


# ── login links ───────────────────────────────────────────────────────────────


def test_login_link_demo_id_refused():
    """Invariant: the demo organizer id is refused on the login-link
    mint too — the demo cabinet is anonymous by design, a deep link
    into it must never establish a session. In Python the refusal lives
    in the job handlers (the minters), so the delegate is the handler
    test that asserts no `auth:login-link:*` key is created for a demo
    booking."""
    _assert_test_exists("tests_py.jobs.test_handlers", "test_handle_booking_demo_refused")


def test_login_link_consumed_on_post_only():
    """Invariant: organizer deep links are consumed on POST, never GET
    — previewers fetch URLs before a human clicks. TS-owned: the
    consumption endpoint is Next.js (`src/server/auth/login-link.ts`,
    consumed via the telegram provider on POST), not the Python API —
    the Python side only mints. Pinned by the TS integration test
    `peek does not consume — consume is single-use`
    (src/server/auth/tickets.integration.test.ts); referenced here so
    the index keeps the convention visible without claiming a Python
    test that does not exist."""
    ts_test = TESTS.parent / "src/server/auth/tickets.integration.test.ts"
    src = ts_test.read_text("utf-8")
    assert "peek does not consume — consume is single-use" in src, (
        "the TS-owned POST-only consumption test must exist — repoint this "
        "entry if it is renamed or moved"
    )


# ── index self-check ──────────────────────────────────────────────────────────

# The explicit list of AGENTS.md "Conventions" bullets this index must
# cover. When a convention is added or the index gains an entry, both
# sides of this set comparison change together — that is the point.
EXPECTED_ENTRIES = {
    "test_seat_reserve_is_single_conditional_update",
    "test_cancel_releases_seats_and_is_idempotent",
    "test_demo_organizer_rejected_on_every_write",
    "test_anonymous_cabinet_visitor_cannot_write",
    "test_guest_ticket_replay_fails",
    "test_guest_ticket_purpose_is_enforced",
    "test_notification_failure_never_fails_booking",
    "test_duplicate_outbox_delivery_not_resent",
    "test_unreachable_recipient_completes_delivery",
    "test_jobs_receiver_verifies_signature_before_anything",
    "test_qstash_empty_key_forgery_rejected",
    "test_manage_token_hash_is_the_only_lookup_key",
    "test_expired_manage_token_refused_on_read_and_cancel",
    "test_delete_slot_with_cancelled_booking_is_409",
    "test_rate_limiter_fails_open",
    "test_forwarded_for_ignored_without_trust",
    "test_replaced_media_cleanup_is_best_effort_and_referenced",
    "test_login_links_are_single_use_and_safe",
    "test_login_link_demo_id_refused",
    "test_login_link_consumed_on_post_only",
    "test_route_set_equals_spec",
    "test_merge_patch_pair_rule_both_directions",
    "test_body_bound_is_1mb",
    "test_validation_error_does_not_consume_guest_ticket",
    "test_production_env_validation_is_loud",
    "test_cold_import_stays_lean",
    "test_api_errors_are_localized",
    "test_http_behavior_matches_parity_goldens",
    "test_healthz_recovers_own_panics_and_names_missing_env",
    "test_dev_without_qstash_token_marks_rows_skipped",
    "test_booking_created_fans_out_one_job_per_recipient",
}


def test_index_covers_the_conventions_list():
    """The index is a flat, greppable checklist. This comparison only
    catches drift between the entries and EXPECTED_ENTRIES within this
    file — it does not diff against AGENTS.md itself; the audit that a
    new convention gained an entry is human review. No orphan entries,
    no missing bullets relative to the explicit list."""
    actual = {
        name
        for name, fn in globals().items()
        if name.startswith("test_")
        and inspect.isfunction(fn)
        and name != "test_index_covers_the_conventions_list"
    }
    assert actual == EXPECTED_ENTRIES, (
        f"index drift: missing={EXPECTED_ENTRIES - actual}, orphan={actual - EXPECTED_ENTRIES}"
    )
