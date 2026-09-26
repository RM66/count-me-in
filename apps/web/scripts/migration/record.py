"""Golden-transcript recorder (migration plan §1.4). Run from apps/web:

    uv run --project scripts/migration scripts/migration/record.py

What it does, per scenario YAML in tests_py/parity/scenarios/:
  1. starts `go run ./cmd/dev` on port 3101 with a pinned env
     (APP_URL=http://127.0.0.1:3101 so the QStash signature `sub` binding
     is deterministic; QSTASH_URL pointing at the local sink; a fake
     TELEGRAM_BOT_TOKEN so widget HMAC is deterministic; fake R2 creds so
     presigned URLs are deterministic up to the signature, which is
     normalized away);
  2. resets state before each scenario: TRUNCATE of every table in the
     public schema (except Drizzle's migrations table), demo reseed,
     Redis FLUSHDB — rate-limit buckets, tickets and outbox claim keys
     included;
  3. resolves placeholders (<guestTicket>, <session>, <slotId>, …) —
     tickets/sessions minted with the same algorithms the Go tests use
     (pkg/authtest), QStash signatures minted the way pkg/jobs/receiver
     verifies them;
  4. sends each request and stores {status, headers, body, body_raw} in
      tests_py/parity/golden/<scenario>.json. `body_raw` keeps the raw
      response bytes (with the same placeholder substitutions) so the
      byte-level JSON encoding rules (json-encoding.md) are checkable:
      HTML escaping, key order, trailing newline, spacing. UUIDs,
      timestamps, tokens, presigned URLs are normalized to placeholders
      (`<uuid:1>`, `<ts:1>`, … by first appearance). `content-length` is
      NOT recorded as a number — Go's RFC3339Nano drops trailing zeros,
      so timestamp lengths (and thus the header) float run to run; the
      recorder stores the FACTS `contentLengthMatchesBody` (header ==
      len(raw body)) and `transferEncodingChunked` (absent), and the
      byte-level pin lives in `body_raw`. Timestamp RELATIONS are not
      recorded at all: the only timestamp pair any response carries is
      server-generated `createdAt` next to scenario-authored `startsAt`
      — a delta that floats run to run and cannot be asserted. The
      manage-token +24h expiry is NOT on the wire either (the guest DTO
      carries only `canCancel`), so timestamp invariants are asserted in
      the db/contracts tests (`TestCanCancelBooking`), not in HTTP
      goldens;
  5. records outbound sink calls alongside each step; a step may declare
     `expectSink: N` — the recorder then waits up to 2s for exactly N
     calls and fails the recording if fewer arrive (a publish that never
     lands must not silently produce `sink: []`).

Determinism check (plan §1.4 verify): run the recorder twice and
compare the two golden dirs with `diff -r` (see the plan's verify
command — it removes the first copy before re-copying, so a rerun
never nests directories).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import httpx
import redis as redis_lib
import yaml

HERE = Path(__file__).resolve().parent
WEB = HERE.parent.parent  # apps/web
SCENARIOS = WEB / "tests_py" / "parity" / "scenarios"
GOLDEN = WEB / "tests_py" / "parity" / "golden"

PORT = 3101
BASE = f"http://127.0.0.1:{PORT}"
SINK_PORT = 3199
SINK_OUT = HERE / "sink-calls.jsonl"

# Pinned recorder env — every value is deterministic. Process env wins
# over the .env file loaded by cmd/dev (loadDotEnv semantics).
AUTH_SECRET = "parity-recorder-secret"
TELEGRAM_BOT_TOKEN = "123456:parity-recorder-bot-token"
QSTASH_CURRENT_KEY = "parity_current_signing_key"
QSTASH_NEXT_KEY = "parity_next_signing_key"
POSTGRES_URL = os.environ.get("POSTGRES_URL", "postgresql://countmein:countmein@localhost:5432/countmein")
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")

DEMO_ORGANIZER_ID = "01930000-0000-7000-8000-0000000000de"
SESSION_ORGANIZER_SLUG = "parity-org"

UUID_RE = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE
)
ISO_TS_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})")
TOKEN_KEYS = {"manageToken", "ticket", "guestTicket", "token"}
# Keys whose string values are service ids (21-char URL-safe ids).
SID_KEYS = {"id", "serviceId"}
# Rate-limit windows (seconds) per request path — the bound a recorded
# Retry-After value is checked against (0 < v ≤ window). Mirrors the
# RateLimitConfig literals in pkg/routes + pkg/api/server.go.
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


# ── credential minting (mirrors pkg/authtest + pkg/auth) ────────────────────


def derived_key(secret: str) -> bytes:
    prk = hmac.new(b"countmein", secret.encode(), hashlib.sha256).digest()
    okm = hmac.new(prk, b"CountMeIn Organizer API Token Key v1" + bytes([1]), hashlib.sha256).digest()
    return okm[:32]


def mint_session(sub: str, slug: str) -> str:
    header = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).rstrip(b"=").decode()
    now = int(time.time())
    payload = base64.urlsafe_b64encode(
        json.dumps({"sub": sub, "slug": slug, "iat": now, "exp": now + 3600}).encode()
    ).rstrip(b"=").decode()
    sig = hmac.new(derived_key(AUTH_SECRET), f"{header}.{payload}".encode(), hashlib.sha256).digest()
    return f"{header}.{payload}." + base64.urlsafe_b64encode(sig).rstrip(b"=").decode()


def mint_ticket(r: redis_lib.Redis, purpose: str, messenger_id: str, name: str) -> str:
    token = base64.urlsafe_b64encode(os.urandom(32)).rstrip(b"=").decode()
    payload = json.dumps(
        {"messenger": "telegram", "messengerId": messenger_id, "displayName": name, "purpose": purpose}
    )
    r.set(f"auth:ticket:{token}", payload, ex=600)
    return token


def mint_widget_payload(bot_token: str, user_id: int, name: str) -> dict:
    """Telegram Login Widget payload with a valid HMAC (pkg/auth/telegram.go)."""
    data: dict[str, Any] = {"id": user_id, "first_name": name, "auth_date": int(time.time())}
    dcs = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    secret = hashlib.sha256(bot_token.encode()).digest()
    data["hash"] = hmac.new(secret, dcs.encode(), hashlib.sha256).hexdigest()
    return data


def mint_qstash_signature(body: bytes, sub: str, key: str = QSTASH_CURRENT_KEY) -> str:
    """HS256 JWT over the body, mirroring pkg/jobs/receiver.go verification."""
    header = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).rstrip(b"=").decode()
    body_hash = base64.urlsafe_b64encode(hashlib.sha256(body).digest()).rstrip(b"=").decode()
    now = int(time.time())
    claims = base64.urlsafe_b64encode(
        json.dumps({"iss": "Upstash", "sub": sub, "exp": now + 300, "nbf": now, "body": body_hash}).encode()
    ).rstrip(b"=").decode()
    sig = hmac.new(key.encode(), f"{header}.{claims}".encode(), hashlib.sha256).digest()
    return f"{header}.{claims}." + base64.urlsafe_b64encode(sig).rstrip(b"=").decode()


# ── state reset ─────────────────────────────────────────────────────────────


def psql(sql: str, vars: dict[str, str] | None = None) -> str:
    """Run psql inside the compose container, with psql -v variables (no
    string interpolation of values into SQL). SQL is piped on stdin —
    psql variable substitution (:'name') does not work with -c."""
    cmd = ["docker", "exec", "-i", "countmein_postgres", "psql", "-U", "countmein", "-d", "countmein", "-v", "ON_ERROR_STOP=1"]
    for name, value in (vars or {}).items():
        cmd += ["-v", f"{name}={value}"]
    return subprocess.run(cmd, input=sql, check=True, capture_output=True, text=True).stdout


def reset_state(r: redis_lib.Redis) -> None:
    """Truncate EVERY table in the public schema (except Drizzle's
    migrations bookkeeping), reseed demo, flush Redis. Deriving the table
    list from the schema means a new table cannot stay dirty between
    scenarios."""
    psql(
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
    subprocess.run(
        ["bun", "run", "db:seed:demo"],
        cwd=str(WEB.parent.parent / "packages" / "db"), check=True, capture_output=True,
    )
    r.flushdb()


def flush_rate_limits(r: redis_lib.Redis) -> None:
    """Delete only rl:* keys — keeps data, resets rate-limit buckets."""
    keys = [k.decode() if isinstance(k, bytes) else k for k in r.keys("rl:*")]
    if keys:
        r.delete(*keys)


def expire_manage_token(booking_id: str) -> None:
    """Force the booking's manage token into the past (ADR-020 expiry)."""
    psql(
        "UPDATE bookings SET manage_token_expires_at = now() - interval '1 hour' WHERE id = :'booking_id';",
        {"booking_id": booking_id},
    )


# ── normalization ───────────────────────────────────────────────────────────


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



# ── recorder ────────────────────────────────────────────────────────────────


def server_env() -> dict[str, str]:
    env = {k: v for k, v in os.environ.items()}
    env.update(
        {
            "PORT": str(PORT),
            "APP_URL": BASE,
            "AUTH_SECRET": AUTH_SECRET,
            "POSTGRES_URL": POSTGRES_URL,
            "REDIS_URL": REDIS_URL,
            "TELEGRAM_BOT_TOKEN": TELEGRAM_BOT_TOKEN,
            "QSTASH_TOKEN": "parity-qstash-token",
            "QSTASH_URL": f"http://127.0.0.1:{SINK_PORT}",
            "QSTASH_CURRENT_SIGNING_KEY": QSTASH_CURRENT_KEY,
            "QSTASH_NEXT_SIGNING_KEY": QSTASH_NEXT_KEY,
            # Fake R2 creds: presigning must succeed deterministically
            # (the signature itself is normalized out of the golden).
            "R2_ACCOUNT_ID": "parity-account",
            "R2_ACCESS_KEY_ID": "parity-access-key",
            "R2_SECRET_ACCESS_KEY": "parity-secret-access-key",
            "R2_BUCKET": "parity-bucket",
            "R2_PUBLIC_BASE_URL": "https://parity.r2.example",
        }
    )
    for var in ("NODE_ENV", "VERCEL_ENV", "STRICT_ENV", "TRUST_PROXY_HEADERS", "VERCEL"):
        env.pop(var, None)
    return env


def start_server() -> subprocess.Popen:
    proc = subprocess.Popen(
        ["go", "run", "./cmd/dev"], cwd=str(WEB), env=server_env(),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(240):
        try:
            httpx.get(f"{BASE}/api/healthz", timeout=1.0)
            return proc
        except httpx.HTTPError:
            if proc.poll() is not None:
                raise RuntimeError("go dev server exited during startup")
            time.sleep(0.5)
    raise RuntimeError("go dev server did not become ready")


def read_sink() -> list[dict]:
    if not SINK_OUT.exists():
        return []
    return [json.loads(x) for x in SINK_OUT.read_text().splitlines() if x.strip()]


def register_session_organizer(client: httpx.Client, r: redis_lib.Redis, captures: dict) -> None:
    """Register the organizer <session> points at (deterministic identity)."""
    ticket = mint_ticket(r, "organizer", "900100201", "Parity Organizer")
    resp = client.post(
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


def resolve_placeholders(
    value: object, captures: dict, r: redis_lib.Redis, mint_guest: bool = False
) -> object:
    if isinstance(value, str):
        if value == "<guestTicket>":
            # A step with `mint: guestTicket` starts a fresh ticket; a
            # step WITHOUT it reuses the last one — that is how the
            # replay scenario replays the *same* (consumed) ticket.
            if mint_guest or "lastGuestTicket" not in captures:
                captures["lastGuestTicket"] = mint_ticket(r, "guest", "900100200", "Parity Guest")
            return captures["lastGuestTicket"]
        if value == "<signupTicket>":
            return mint_ticket(r, "organizer", "900100201", "Parity Organizer")
        if value == "<session>":
            return captures["session"]
        if value == "<demoSession>":
            return mint_session(DEMO_ORGANIZER_ID, "demo")
        if value == "<widgetPayload>":
            return mint_widget_payload(TELEGRAM_BOT_TOKEN, 900100200, "Parity Guest")
        for key in ("slotId", "serviceId", "bookingId", "manageToken"):
            if value == f"<{key}>":
                return captures[key]
        return value
    if isinstance(value, dict):
        return {k: resolve_placeholders(v, captures, r, mint_guest) for k, v in value.items()}
    if isinstance(value, list):
        return [resolve_placeholders(x, captures, r, mint_guest) for x in value]
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


def run_scenario(client: httpx.Client, r: redis_lib.Redis, scenario_path: Path) -> dict:
    scenario = yaml.safe_load(scenario_path.read_text())
    captures: dict[str, Any] = {}
    norm = Normalizer()
    steps_out: list[dict] = []
    needs_session = "<session>" in scenario_path.read_text()

    for step in scenario["steps"]:
        if step.get("reset"):
            reset_state(r)
            SINK_OUT.unlink(missing_ok=True)
            captures.clear()
            if needs_session:
                register_session_organizer(client, r, captures)
        if step.get("flushRateLimits"):
            flush_rate_limits(r)
        if step.get("expireManageToken"):
            expire_manage_token(str(captures["bookingId"]))
        if "request" not in step:
            continue

        req = resolve_placeholders(step["request"], captures, r, mint_guest=step.get("mint") == "guestTicket")
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

            sink_before = len(read_sink())
            resp = client.request(req["method"], BASE + req["path"], content=body_bytes, headers=headers)

            # Post-commit publishes are async from the response. If the
            # step declares expectSink: N, wait (up to 2s — the publish
            # budget is 1500ms) for exactly N calls and fail loudly when
            # they do not arrive; a missing publish must not silently
            # record sink: []. Without expectSink, poll briefly until
            # stable.
            expect_sink = step.get("expectSink")
            deadline = time.monotonic() + (2.0 if expect_sink is not None else 0.6)
            while True:
                got = len(read_sink()) - sink_before
                if expect_sink is not None:
                    if got >= int(expect_sink) or time.monotonic() > deadline:
                        break
                else:
                    if got > 0 or time.monotonic() > deadline:
                        break
                time.sleep(0.1)
            sink_calls = read_sink()[sink_before:]
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

            # Record ALL response headers except per-run noise; the
            # middleware sets security headers the parity check must
            # see. content-length is NOT recorded as a number — Go's
            # RFC3339Nano drops trailing zeros, so timestamp lengths
            # (and thus the header) float run to run; the facts
            # `contentLengthMatchesBody` and `transferEncodingChunked`
            # below pin what matters (header == len(body), no chunked
            # encoding), and the byte-level pin lives in body_raw.
            EXCLUDED_HEADERS = {"date", "server", "x-vercel-id", "x-vercel-cache", "content-length"}
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
                    resp_headers[k] = "<retry-after:seconds>" if re.fullmatch(r"\d{1,3}", v) else "<retry-after>"
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
                    cl_header == str(len(raw_bytes)) if cl_header is not None else len(raw_bytes) == 0
                ),
                "transferEncodingChunked": "chunked" in resp.headers.get("transfer-encoding", "").lower(),
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
                        {"path": norm.text(c["path"]), "body": norm.json(json.loads(c["body"]) if c["body"] else None)}
                        # Sort the RAW entries by semantic identity
                        # (recipient) BEFORE normalizing: outbox UUID
                        # numbering is assigned in encounter order, and
                        # arrival order of the two post-commit publishes
                        # is not deterministic.
                        for c in sorted(
                            sink_calls,
                            key=lambda c: (c["path"], str((json.loads(c["body"]) or {}).get("recipient", ""))),
                        )
                    ],
                }
            )

    return {
        "scenario": scenario["name"],
        "steps": steps_out,
    }


def main() -> None:
    r = redis_lib.Redis.from_url(REDIS_URL)
    r.ping()

    GOLDEN.mkdir(parents=True, exist_ok=True)
    server = start_server()
    sink = subprocess.Popen(
        [sys.executable, str(HERE / "sink.py"), str(SINK_PORT), str(SINK_OUT)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        with httpx.Client(timeout=30.0) as client:
            for scenario_path in sorted(SCENARIOS.glob("*.yaml")):
                print(f"recording {scenario_path.stem} …", file=sys.stderr)
                golden = run_scenario(client, r, scenario_path)
                out = GOLDEN / f"{scenario_path.stem}.json"
                out.write_text(json.dumps(golden, indent=2, ensure_ascii=False) + "\n")
        print("done", file=sys.stderr)
    finally:
        sink.send_signal(signal.SIGTERM)
        server.send_signal(signal.SIGTERM)
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()


if __name__ == "__main__":
    main()
