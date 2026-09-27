"""Parity replay (migration plan §3.14).

Replays every scenario in tests_py/parity/scenarios/ against the Python
ASGI app and asserts the normalized transcript equals the golden one
recorded from the Go API (tests_py/parity/golden/). The harness mirrors
the retired recorder step for step — same pinned env, same state
reset (TRUNCATE + demo reseed + Redis FLUSHDB), same placeholder
minting, same normalization — so any difference the comparison reports
is a behavioral difference between the Go and Python implementations,
not harness drift.

Deliberate differences from the recorder, all forced by in-process
replay:
- requests go through httpx.ASGITransport instead of a TCP server, so
  `date`/`server` headers never exist and publishes (background tasks)
  complete before the response returns to the client;
- the outbound sink is the app's own transport seams (queue._post,
  jobs.telegram._post) instead of the retired recorder's sink — the
  recorded {path, body} shape is identical;
- the demo seed is the Python port (db.seed.seed_demo) instead of
  `bun run db:seed:demo` — a seed drift is exactly the kind of parity
  break this test exists to catch.

Needs real Postgres and Redis (docker compose up); the module skips
when either is unreachable.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import socket
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
import pytest
import redis.asyncio as aioredis
import yaml
from _lib.countmein import queue as queue_mod
from _lib.countmein import redis as redis_mod
from _lib.countmein.app import create_app
from _lib.countmein.contracts.constants_gen import DEMO_ORGANIZER_ID
from _lib.countmein.db import client as db_client
from _lib.countmein.db.seed import seed_demo
from _lib.countmein.jobs import telegram as telegram_mod
from httpx import ASGITransport
from sqlalchemy import text

HERE = Path(__file__).resolve().parent
SCENARIOS = HERE / "scenarios"
GOLDEN = HERE / "golden"

# The recorder's pinned env (record.py server_env) — every value
# deterministic, so signatures, presigned URLs and QStash `sub` bindings
# in the goldens are reproducible.
BASE = "http://127.0.0.1:3101"
AUTH_SECRET = "parity-recorder-secret"
TELEGRAM_BOT_TOKEN = "123456:parity-recorder-bot-token"
QSTASH_CURRENT_KEY = "parity_current_signing_key"
QSTASH_NEXT_KEY = "parity_next_signing_key"
POSTGRES_URL = os.environ.get(
    "POSTGRES_URL", "postgresql://countmein:countmein@localhost:5432/countmein"
)
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")

SESSION_ORGANIZER_SLUG = "parity-org"

ENV_OVERRIDES = {
    "APP_URL": BASE,
    "AUTH_SECRET": AUTH_SECRET,
    "POSTGRES_URL": POSTGRES_URL,
    "REDIS_URL": REDIS_URL,
    "TELEGRAM_BOT_TOKEN": TELEGRAM_BOT_TOKEN,
    "QSTASH_TOKEN": "parity-qstash-token",
    "QSTASH_URL": "http://127.0.0.1:3199",
    "QSTASH_CURRENT_SIGNING_KEY": QSTASH_CURRENT_KEY,
    "QSTASH_NEXT_SIGNING_KEY": QSTASH_NEXT_KEY,
    # Fake R2 creds: presigning must succeed deterministically (the
    # signature itself is normalized out of the golden).
    "R2_ACCOUNT_ID": "parity-account",
    "R2_ACCESS_KEY_ID": "parity-access-key",
    "R2_SECRET_ACCESS_KEY": "parity-secret-access-key",
    "R2_BUCKET": "parity-bucket",
    "R2_PUBLIC_BASE_URL": "https://parity.r2.example",
}
ENV_REMOVED = ("NODE_ENV", "VERCEL_ENV", "STRICT_ENV", "TRUST_PROXY_HEADERS", "VERCEL")

UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE)
ISO_TS_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})")
TOKEN_KEYS = {"manageToken", "ticket", "guestTicket", "token"}
SID_KEYS = {"id", "serviceId"}
RL_WINDOWS = {
    "/api/healthz": 60,
    "/api/auth/telegram-guest": 60,
    "/api/auth/telegram-signup": 60,
    "/api/organizers": 3600,
    "/api/bookings": 60,
    "/api/bookings/lookup": 60,
    "/api/bookings/cancel": 60,
    "/api/bookings/cancel-by-organizer": 60,
}
EXCLUDED_HEADERS = {"date", "server", "x-vercel-id", "x-vercel-cache", "content-length"}


# ── credential minting (mirrors record.py / authtest) ─────────────────────


def derived_key(secret: str) -> bytes:
    prk = hmac.new(b"countmein", secret.encode(), hashlib.sha256).digest()
    okm = hmac.new(
        prk, b"CountMeIn Organizer API Token Key v1" + bytes([1]), hashlib.sha256
    ).digest()
    return okm[:32]


def mint_session(sub: str, slug: str) -> str:
    header = (
        base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
        .rstrip(b"=")
        .decode()
    )
    now = int(time.time())
    payload = (
        base64.urlsafe_b64encode(
            json.dumps({"sub": sub, "slug": slug, "iat": now, "exp": now + 3600}).encode()
        )
        .rstrip(b"=")
        .decode()
    )
    sig = hmac.new(
        derived_key(AUTH_SECRET), f"{header}.{payload}".encode(), hashlib.sha256
    ).digest()
    return f"{header}.{payload}." + base64.urlsafe_b64encode(sig).rstrip(b"=").decode()


async def mint_ticket(r: aioredis.Redis, purpose: str, messenger_id: str, name: str) -> str:
    token = base64.urlsafe_b64encode(os.urandom(32)).rstrip(b"=").decode()
    payload = json.dumps(
        {
            "messenger": "telegram",
            "messengerId": messenger_id,
            "displayName": name,
            "purpose": purpose,
        }
    )
    await r.set(f"auth:ticket:{token}", payload, ex=600)
    return token


def mint_widget_payload(bot_token: str, user_id: int, name: str) -> dict:
    """Telegram Login Widget payload with a valid HMAC (auth/telegram.py)."""
    data: dict[str, Any] = {"id": user_id, "first_name": name, "auth_date": int(time.time())}
    dcs = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    secret = hashlib.sha256(bot_token.encode()).digest()
    data["hash"] = hmac.new(secret, dcs.encode(), hashlib.sha256).hexdigest()
    return data


def mint_qstash_signature(body: bytes, sub: str, key: str = QSTASH_CURRENT_KEY) -> str:
    """HS256 JWT over the body, mirroring jobs/receiver.py verification."""
    header = (
        base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
        .rstrip(b"=")
        .decode()
    )
    body_hash = base64.urlsafe_b64encode(hashlib.sha256(body).digest()).rstrip(b"=").decode()
    now = int(time.time())
    claims = (
        base64.urlsafe_b64encode(
            json.dumps(
                {"iss": "Upstash", "sub": sub, "exp": now + 300, "nbf": now, "body": body_hash}
            ).encode()
        )
        .rstrip(b"=")
        .decode()
    )
    sig = hmac.new(key.encode(), f"{header}.{claims}".encode(), hashlib.sha256).digest()
    return f"{header}.{claims}." + base64.urlsafe_b64encode(sig).rstrip(b"=").decode()


# ── state reset (mirrors record.py reset_state) ────────────────────────────────


async def reset_state(r: aioredis.Redis) -> None:
    """Truncate EVERY table in the public schema (except Drizzle's
    migrations bookkeeping), reseed demo, flush Redis. Deriving the
    table list from the schema means a new table cannot stay dirty
    between scenarios."""
    async with db_client.engine().begin() as conn:
        await conn.execute(
            text(
                """
                DO $$
                DECLARE t text;
                BEGIN
                    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
                    LOOP
                        IF t <> 'drizzle_migrations' AND t <> '__drizzle_migrations' THEN
                            EXECUTE format('TRUNCATE TABLE %I CASCADE', t);
                        END IF;
                    END LOOP;
                END $$;
                """
            )
        )
    await seed_demo(datetime.now(UTC))
    await r.flushdb()


async def flush_rate_limits(r: aioredis.Redis) -> None:
    """Delete only rl:* keys — keeps data, resets rate-limit buckets."""
    keys = [k.decode() if isinstance(k, bytes) else k for k in await r.keys("rl:*")]
    if keys:
        await r.delete(*keys)


async def expire_manage_token(booking_id: str) -> None:
    """Force the booking's manage token into the past (ADR-020 expiry)."""
    async with db_client.engine().begin() as conn:
        await conn.execute(
            text(
                "UPDATE bookings SET manage_token_expires_at = now() - interval '1 hour' "
                "WHERE id = :booking_id"
            ),
            {"booking_id": booking_id},
        )


# Fixed ids for the demo-refusal scenario — mirrors record.py (§1.4:
# never use the drifting demo seed as scenario data).
DEMO_PARITY_SERVICE_ID = "DemoParityService0001"
DEMO_PARITY_SLOT_ID = "01930000-0000-7000-8000-00000000f001"
DEMO_PARITY_BOOKING_ID = "01930000-0000-7000-8000-00000000f002"
DEMO_PARITY_MANAGE_TOKEN = "demo-manage-token-parity-0000000001"


async def seed_demo_slot(captures: dict) -> None:
    """A demo-organizer service + a slot 30 days out, inserted directly
    (mirrors record.py seed_demo_slot)."""
    async with db_client.engine().begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO services (id, organizer_id, title, default_price, default_capacity, "
                "default_duration_minutes, max_seats_per_booking) "
                "VALUES (:sid, :org, 'Demo Parity Service', '10 EUR', 10, 60, 4) "
                "ON CONFLICT (id) DO NOTHING"
            ),
            {"sid": DEMO_PARITY_SERVICE_ID, "org": DEMO_ORGANIZER_ID},
        )
        await conn.execute(
            text(
                "INSERT INTO time_slots (id, service_id, starts_at, duration_minutes, capacity, booked_count) "
                "VALUES (:slot, :sid, now() + interval '30 days', 60, 10, 0) "
                "ON CONFLICT (id) DO NOTHING"
            ),
            {"slot": DEMO_PARITY_SLOT_ID, "sid": DEMO_PARITY_SERVICE_ID},
        )
    captures["serviceId"] = DEMO_PARITY_SERVICE_ID
    captures["slotId"] = DEMO_PARITY_SLOT_ID


async def seed_demo_booking(captures: dict) -> None:
    """A confirmed booking on the demo slot with a known manage token,
    inserted directly (mirrors record.py seed_demo_booking)."""
    token_hash = hashlib.sha256(DEMO_PARITY_MANAGE_TOKEN.encode()).hexdigest()
    async with db_client.engine().begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO bookings (id, time_slot_id, status, seats, guest_name, guest_messenger, "
                "guest_messenger_id, guest_locale, manage_token, manage_token_hash, manage_token_expires_at) "
                "VALUES (:bid, :slot, 'confirmed', 1, 'Demo Guest', 'telegram', 'demo-parity-guest', 'en', "
                ":token, :hash, now() + interval '31 days') "
                "ON CONFLICT (id) DO NOTHING"
            ),
            {
                "bid": DEMO_PARITY_BOOKING_ID,
                "slot": DEMO_PARITY_SLOT_ID,
                "token": DEMO_PARITY_MANAGE_TOKEN,
                "hash": token_hash,
            },
        )
    captures["manageToken"] = DEMO_PARITY_MANAGE_TOKEN


# ── normalization (verbatim from record.py) ───────────────────────────────────


class Normalizer:
    """Normalizes volatile values to stable placeholders, by first
    appearance. Timestamps get numbered placeholders (<ts:1>, …) and the
    deltas between timestamps seen in the same JSON object are recorded
    so relations (expiry − start = 24h) survive normalization."""

    def __init__(self) -> None:
        self.seen: dict[str, str] = {}
        self.uuid_n = 0
        self.sid_n = 0
        self.ts_n = 0
        self.ts_values: dict[str, str] = {}

    def text(self, s: str) -> str:
        def uuid_sub(m: re.Match[str]) -> str:
            v = m.group(0).lower()
            if v not in self.seen:
                self.uuid_n += 1
                self.seen[v] = f"<uuid:{self.uuid_n}>"
            return self.seen[v]

        s = UUID_RE.sub(uuid_sub, s)
        # Service ids appear in paths after /services/ — normalize only
        # there, never in free text (a 21-char slug or name must not be
        # mangled).
        s = re.sub(
            r"(/api/services/)([A-Za-z0-9_-]{21})",
            lambda m: m.group(1) + self.sid_for(m.group(2)),
            s,
        )
        s = ISO_TS_RE.sub(self.ts_sub, s)
        # Media object keys carry a random per-call suffix
        # (avatar-<hex>.png, photo-<hex>.png) — normalize the filename
        # so the golden does not pin one particular roll (mirrors
        # record.py).
        s = re.sub(r"(avatar|photo)-[0-9a-f]{8}(\.\w+)", r"\1-<media>\2", s)
        # Presigned R2 URLs carry a time-dependent SigV4 signature.
        if "X-Amz-Signature" in s or "X-Amz-Credential" in s:
            return "<presigned-url>"
        return s

    def sid_for(self, v: str) -> str:
        if v not in self.seen:
            self.sid_n += 1
            self.seen[v] = f"<sid:{self.sid_n}>"
        return self.seen[v]

    def ts_sub(self, m: re.Match[str]) -> str:
        v = m.group(0)
        if v not in self.seen:
            self.ts_n += 1
            self.seen[v] = f"<ts:{self.ts_n}>"
        self.ts_values[self.seen[v]] = v
        return self.seen[v]

    def json(self, obj: object, key: str | None = None) -> object:
        if isinstance(obj, int) and key == "auth_date":
            return "<epoch>"
        if isinstance(obj, str):
            if key in TOKEN_KEYS and len(obj) >= 20:
                return "<token>"
            if key == "hash":
                return "<hash>"
            # Service ids: normalize ONLY by key name, never by shape —
            # a 21-char slug/name in free text must not be touched.
            if key in SID_KEYS and re.fullmatch(r"[A-Za-z0-9_-]{21}", obj):
                return self.sid_for(obj)
            return self.text(obj)
        if isinstance(obj, list):
            return [self.json(x) for x in obj]
        if isinstance(obj, dict):
            return {k: self.json(v, k) for k, v in obj.items()}
        return obj

    def raw(self, text: str) -> str:
        """Normalize a raw JSON byte string with the same value-level
        substitutions the parsed form gets: tokens by key name, service
        ids by key position. Targeted regexes, never shape-based — free
        text must not be mangled."""
        text = self.text(text)
        text = re.sub(
            r'("(?:ticket|manageToken|guestToken)"):("[^"]{20,}")',
            lambda m: f'{m.group(1)}:"<token>"',
            text,
        )
        text = re.sub(
            r'("(?:serviceId|id)"):("([A-Za-z0-9_-]{21})")',
            lambda m: f'{m.group(1)}:"{self.sid_for(m.group(3))}"',
            text,
        )
        return text


# ── outbound sink (the app's transport seams) ─────────────────────────────────


class Sink:
    """Records every outbound POST the app attempts (QStash publish,
    Telegram send) as {path, body} — the same shape the retired
    recorder's sink wrote. Any host is accepted: a call
    the golden does not show shows up as an extra sink entry and fails
    the comparison."""

    def __init__(self) -> None:
        self.calls: list[dict[str, str]] = []

    def _record(self, url: str, content: bytes | str) -> httpx.Response:
        path = url.split("://", 1)[1]
        path = "/" + path.split("/", 1)[1] if "/" in path else "/"
        body = content if isinstance(content, str) else content.decode("utf-8", "replace")
        self.calls.append({"path": path, "body": body})
        if "api.telegram.org" in url:
            return httpx.Response(200, json={"ok": True, "result": {"message_id": 1}})
        return httpx.Response(200, json={"messageId": "sink-recorded"})

    def qstash_post(self, url, *, content=None, headers=None, timeout=None):  # type: ignore[no-untyped-def]
        return self._record(str(url), content or b"")

    def telegram_post(self, url, *, content=None, headers=None, timeout=None):  # type: ignore[no-untyped-def]
        return self._record(str(url), content or b"")

    def install(self) -> None:
        queue_mod._post = self.qstash_post
        telegram_mod._post = self.telegram_post

    def uninstall(self) -> None:
        queue_mod._reset_for_test()
        telegram_mod._reset_for_test()


# ── scenario runner (mirrors record.py run_scenario) ───────────────────────────


async def resolve_placeholders(
    value: object, captures: dict, r: aioredis.Redis, mint_guest: bool = False
) -> object:
    if isinstance(value, str):
        if value == "<guestTicket>":
            # A step with `mint: guestTicket` starts a fresh ticket; a
            # step WITHOUT it reuses the last one — that is how the
            # replay scenario replays the *same* (consumed) ticket.
            if mint_guest or "lastGuestTicket" not in captures:
                captures["lastGuestTicket"] = await mint_ticket(
                    r, "guest", "900100200", "Parity Guest"
                )
            return captures["lastGuestTicket"]
        if value == "<signupTicket>":
            return await mint_ticket(r, "organizer", "900100201", "Parity Organizer")
        if value == "<session>":
            return captures["session"]
        if value == "<demoSession>":
            return mint_session(DEMO_ORGANIZER_ID, "demo")
        if value == "<widgetPayload>":
            return mint_widget_payload(TELEGRAM_BOT_TOKEN, 900100200, "Parity Guest")
        # Captured ids also appear INSIDE larger strings — a request
        # path like /api/slots/<slotId> (mirrors record.py).
        for key in ("slotId", "serviceId", "bookingId", "manageToken"):
            if f"<{key}>" in value:
                return value.replace(f"<{key}>", str(captures[key]))
        return value
    if isinstance(value, dict):
        return {k: await resolve_placeholders(v, captures, r, mint_guest) for k, v in value.items()}
    if isinstance(value, list):
        return [await resolve_placeholders(x, captures, r, mint_guest) for x in value]
    return value


def capture_from_response(path: str, body: object, captures: dict) -> None:
    if not isinstance(body, dict):
        return
    if "services" in path:
        if isinstance(body.get("service"), dict):
            captures.setdefault("serviceId", body["service"]["id"])
        if isinstance(body.get("services"), list) and body["services"]:
            captures.setdefault("serviceId", body["services"][0]["id"])
    if "slots" in path:
        if isinstance(body.get("slot"), dict):
            captures.setdefault("slotId", body["slot"]["id"])
            captures.setdefault("serviceId", body["slot"]["serviceId"])
        if isinstance(body.get("slots"), list) and body["slots"]:
            captures.setdefault("slotId", body["slots"][0]["id"])
            captures.setdefault("serviceId", body["slots"][0]["serviceId"])
    if "bookings" in path:
        b = body.get("booking")
        if isinstance(b, dict):
            captures.setdefault("bookingId", b.get("id"))
            if b.get("manageToken"):
                captures["manageToken"] = b["manageToken"]


async def register_session_organizer(
    client: httpx.AsyncClient, r: aioredis.Redis, captures: dict
) -> None:
    """Register the organizer <session> points at (deterministic identity)."""
    ticket = await mint_ticket(r, "organizer", "900100201", "Parity Organizer")
    resp = await client.post(
        f"{BASE}/api/organizers",
        json={
            "ticket": ticket,
            "slug": SESSION_ORGANIZER_SLUG,
            "name": "Parity Organizer",
            "timezone": "Europe/Belgrade",
            "language": "en",
        },
    )
    if resp.status_code != 201:
        raise RuntimeError(f"session organizer registration failed: {resp.status_code} {resp.text}")
    organizer_id = resp.json()["organizer"]["id"]
    captures["session"] = mint_session(organizer_id, SESSION_ORGANIZER_SLUG)


async def run_scenario(
    client: httpx.AsyncClient, r: aioredis.Redis, scenario_path: Path, sink: Sink
) -> dict:
    scenario = yaml.safe_load(scenario_path.read_text())
    captures: dict[str, Any] = {}
    norm = Normalizer()
    steps_out: list[dict] = []
    needs_session = "<session>" in scenario_path.read_text()

    for step in scenario["steps"]:
        if step.get("reset"):
            await reset_state(r)
            sink.calls.clear()
            captures.clear()
            if needs_session:
                await register_session_organizer(client, r, captures)
        if step.get("flushRateLimits"):
            await flush_rate_limits(r)
        if step.get("expireManageToken"):
            await expire_manage_token(str(captures["bookingId"]))
        if step.get("seedDemoSlot"):
            await seed_demo_slot(captures)
        if step.get("seedDemoBooking"):
            await seed_demo_booking(captures)
        if "request" not in step:
            continue

        req = await resolve_placeholders(
            step["request"], captures, r, mint_guest=step.get("mint") == "guestTicket"
        )
        repeat = int(step.get("repeat", 1))
        for _ in range(repeat):
            headers = dict(req.get("headers") or {})
            body_bytes: bytes | None = None
            if "body_raw" in req:
                body_bytes = req["body_raw"].encode()
                queue = req["path"].rsplit("/", 1)[-1]
                sub = f"{BASE}/api/jobs/{queue}"
                if step.get("mint") == "qstashSignatureBad":
                    headers["upstash-signature"] = mint_qstash_signature(b"mismatched", sub)
                elif step.get("mint") == "qstashSignature":
                    headers["upstash-signature"] = mint_qstash_signature(body_bytes, sub)
            elif "json" in req:
                body_bytes = json.dumps(req["json"]).encode()
                if "Content-Type" not in headers and req["method"] in ("POST", "PUT", "PATCH"):
                    headers["Content-Type"] = "application/json"

            sink_before = len(sink.calls)
            resp = await client.request(
                req["method"], BASE + req["path"], content=body_bytes, headers=headers
            )

            # The ASGI transport awaits background tasks, so post-commit
            # publishes have landed by the time the response returns;
            # expectSink still pins the exact count.
            expect_sink = step.get("expectSink")
            sink_calls = sink.calls[sink_before:]
            if expect_sink is not None and len(sink_calls) != int(expect_sink):
                raise RuntimeError(
                    f"{scenario_path.stem}: step '{step.get('note', '')}' expected "
                    f"{expect_sink} sink call(s), saw {len(sink_calls)}"
                )

            raw_bytes = resp.content
            try:
                resp_body: object = resp.json()
            except Exception:
                resp_body = resp.text

            capture_from_response(req["path"], resp_body, captures)

            resp_headers = {}
            retry_after_within_window: bool | None = None
            for k, v in resp.headers.items():
                if k.lower() in EXCLUDED_HEADERS:
                    continue
                if k.lower() == "retry-after":
                    # Part of the 429 contract: a positive integer within
                    # the rate-limit window. The exact value is a TTL
                    # countdown (time-dependent) — record the class, not
                    # the number, plus the window bound as a separate
                    # checkable fact (0 < v ≤ window).
                    resp_headers[k] = (
                        "<retry-after:seconds>" if re.fullmatch(r"\d{1,3}", v) else "<retry-after>"
                    )
                    window = RL_WINDOWS.get(req["path"])
                    if window is not None and re.fullmatch(r"\d{1,3}", v):
                        retry_after_within_window = 0 < int(v) <= window
                else:
                    resp_headers[k] = norm.text(v)

            # Raw body with the same substitutions, so byte-level JSON
            # rules (escaping, key order, trailing newline) are
            # verifiable in the replay.
            body_raw = norm.raw(raw_bytes.decode("utf-8", "replace"))

            # Normalize the request and response bodies with the same
            # placeholder substitutions.
            req_body_norm = norm.json(req.get("json") if "json" in req else req.get("body_raw"))
            body_norm = norm.json(resp_body)

            # 204 responses carry no content-length header at all (Go
            # omits it for empty bodies) — an absent header with an
            # empty body counts as a match.
            cl_header = resp.headers.get("content-length")
            response_rec: dict[str, Any] = {
                "status": resp.status_code,
                "headers": resp_headers,
                "body": body_norm,
                "body_raw": body_raw,
                "contentLengthMatchesBody": (
                    cl_header == str(len(raw_bytes))
                    if cl_header is not None
                    else len(raw_bytes) == 0
                ),
                "transferEncodingChunked": "chunked"
                in resp.headers.get("transfer-encoding", "").lower(),
            }
            if retry_after_within_window is not None:
                response_rec["retryAfterWithinWindow"] = retry_after_within_window
            steps_out.append(
                {
                    "note": step.get("note", ""),
                    "request": {
                        "method": req["method"],
                        "path": norm.text(req["path"]),
                        "body": req_body_norm,
                    },
                    "response": response_rec,
                    "sink": [
                        {
                            "path": norm.text(c["path"]),
                            "body": norm.json(json.loads(c["body"]) if c["body"] else None),
                        }
                        # Sort the RAW entries by semantic identity
                        # (recipient) BEFORE normalizing: outbox UUID
                        # numbering is assigned in encounter order, and
                        # arrival order of the two post-commit publishes
                        # is not deterministic.
                        for c in sorted(
                            sink_calls,
                            key=lambda c: (
                                c["path"],
                                str((json.loads(c["body"]) or {}).get("recipient", "")),
                            ),
                        )
                    ],
                }
            )

    return {
        "scenario": scenario["name"],
        "steps": steps_out,
    }


# ── fixtures ──────────────────────────────────────────────────────────────────


def _reachable(url: str, default_port: int) -> bool:
    parts = urlsplit(url)
    host = parts.hostname or "localhost"
    port = parts.port or default_port
    try:
        with socket.create_connection((host, port), timeout=1.0):
            return True
    except OSError:
        return False


@pytest.fixture(scope="module")
def parity_env():
    """Pin the recorder env, build the app once, wire the sink into the
    transport seams. Skips the module when Postgres/Redis are down."""
    if not _reachable(POSTGRES_URL, 5432) or not _reachable(REDIS_URL, 6379):
        pytest.skip("parity replay needs Postgres and Redis (docker compose up)")

    saved = {k: os.environ.get(k) for k in ENV_OVERRIDES}
    removed = {k: os.environ[k] for k in ENV_REMOVED if k in os.environ}
    os.environ.update(ENV_OVERRIDES)
    for k in ENV_REMOVED:
        os.environ.pop(k, None)

    # Singletons may hold state from earlier tests (or an init error
    # cached under the ambient env) — rebuild under the pinned env.
    db_client.reset_for_test()
    redis_mod.reset_for_test()

    app = create_app()
    sink = Sink()
    sink.install()
    try:
        yield app, sink
    finally:
        sink.uninstall()
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        os.environ.update(removed)
        db_client.reset_for_test()
        redis_mod.reset_for_test()


@pytest.mark.parametrize(
    "scenario_path",
    sorted(SCENARIOS.glob("*.yaml")),
    ids=lambda p: p.stem,
)
async def test_replay_matches_golden(parity_env, scenario_path: Path):
    app, sink = parity_env
    golden = json.loads((GOLDEN / f"{scenario_path.stem}.json").read_text())

    r = aioredis.from_url(REDIS_URL)
    transport = ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url=BASE, timeout=30.0) as client:
            transcript = await run_scenario(client, r, scenario_path, sink)
    finally:
        await r.aclose()

    assert transcript == golden, _diff_report(scenario_path.stem, transcript, golden)


def _diff_report(name: str, transcript: dict, golden: dict) -> str:
    """A readable first mismatch instead of one giant dict assert."""
    lines = [f"parity mismatch in {name}:"]
    if transcript.get("scenario") != golden.get("scenario"):
        lines.append(f"  scenario: {transcript.get('scenario')!r} != {golden.get('scenario')!r}")
    t_steps, g_steps = transcript.get("steps", []), golden.get("steps", [])
    for i, (t, g) in enumerate(zip(t_steps, g_steps, strict=False)):
        for section in ("note", "request", "response", "sink"):
            if t.get(section) != g.get(section):
                lines.append(f"  step {i} ({t.get('note', '')!r}) {section}:")
                lines.append(f"    replay: {json.dumps(t.get(section), ensure_ascii=False)}")
                lines.append(f"    golden: {json.dumps(g.get(section), ensure_ascii=False)}")
                break
        else:
            continue
        break
    if len(t_steps) != len(g_steps):
        lines.append(f"  step count: replay {len(t_steps)} != golden {len(g_steps)}")
    return "\n".join(lines)
