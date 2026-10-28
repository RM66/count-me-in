"""The OIDC id_token contract (ADR-026): JWKS signature/claims
verification, the sha256(verifier) == nonce binding, the single-use
nonce claim, freshness windows, claims → identity mapping, and the JWKS
fetch/refetch/cache policy.

JWKS is mocked via respx at the httpx transport; Redis is fakeredis.
A failing validation must never leak which check failed — every case
below raises TelegramValidationFailedError, and the tests assert no
idToken/nonceVerifier ever lands in logs.
"""

from __future__ import annotations

import asyncio
import gzip
import json
import logging
import time

import fakeredis.aioredis
import httpx
import jwt
import pytest
import respx
from _oidc_helpers import (
    b64u,
    id_token_claims,
    make_rsa_key,
    new_verifier,
    nonce_for,
)
from _oidc_helpers import (
    jwks as _oidc_jwks,
)
from countmein import logx
from countmein import redis as redis_mod
from countmein.auth import jwks as jwks_mod
from countmein.auth.telegram import (
    OIDC_TOKEN_MAX_AGE,
    TelegramInvalidError,
    TelegramNotConfiguredError,
    TelegramValidationFailedError,
    validate_telegram_id_token,
)
from cryptography.hazmat.primitives.asymmetric import ec

TEST_BOT_TOKEN = "123456789:TEST-BOT-TOKEN-abcdef"
TEST_CLIENT_ID = "123456789"  # the bot-token prefix IS the Client ID
TEST_ISSUER = "https://oauth.telegram.org"
TEST_KID = "oidc-1"

_PRIVATE_KEY = make_rsa_key()
_OTHER_KEY = make_rsa_key()
_EC_KEY = ec.generate_private_key(ec.SECP256R1())


def _claims(nonce_value: str, **over) -> dict:
    return id_token_claims(nonce_value, TEST_CLIENT_ID, **over)


def _jwk_set(key=_PRIVATE_KEY, extra_keys: list | None = None) -> dict:
    return _oidc_jwks(key, TEST_KID, extra_keys)


def make_token(
    claims: dict, key=_PRIVATE_KEY, *, kid: str | None = TEST_KID, algorithm="RS256"
) -> str:
    return jwt.encode(claims, key, algorithm=algorithm, headers={"kid": kid} if kid else {})


def _body(token: str, verifier: str) -> bytes:
    return json.dumps({"idToken": token, "nonceVerifier": verifier}).encode()


def _mint(over: dict | None = None, **token_kw) -> tuple[bytes, str]:
    """(request body, verifier): the token always carries sha256(verifier)."""
    verifier = new_verifier()
    claims = _claims(nonce_for(verifier), **(over or {}))
    return _body(make_token(claims, **token_kw), verifier), verifier


# ── fixtures ─────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TEST_BOT_TOKEN)
    # warn_every dedups per process — start each test with an empty
    # throttle table so log assertions are order-independent.
    logx._warn_every_last.clear()


@pytest.fixture(autouse=True)
def _jwks_state():
    jwks_mod.reset_for_test()
    yield
    jwks_mod.reset_for_test()


@pytest.fixture()
def fake_redis(monkeypatch):
    fake = fakeredis.aioredis.FakeRedis()
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(redis_mod, "client", lambda: fake)
    return fake


@pytest.fixture()
def jwks_endpoint():
    """The JWKS URL mocked at the httpx transport — call_count pins the
    fetch policy, .mock lets a test swap the response."""
    with respx.mock(assert_all_called=False) as router:
        route = router.get(jwks_mod.JWKS_URL)
        route.mock(return_value=httpx.Response(200, json=_jwk_set()))
        yield route


@pytest.fixture()
def log_capture():
    """Capture logx lines (the logger does not propagate)."""

    class _Capture(logging.Handler):
        def __init__(self) -> None:
            super().__init__()
            self.lines: list[str] = []

        def emit(self, record: logging.LogRecord) -> None:
            self.lines.append(self.format(record))

    handler = _Capture()
    handler.setFormatter(logx._JsonFormatter())
    logger = logging.getLogger("countmein")
    logger.addHandler(handler)
    try:
        yield handler
    finally:
        logger.removeHandler(handler)


def _logged(payload: str, cap: list[str]) -> bool:
    return any(payload in line for line in cap)


# ── happy path / identity mapping ────────────────────────────────────


async def test_valid_id_token(jwks_endpoint, fake_redis):
    body, _ = _mint()
    identity = await validate_telegram_id_token(body)
    assert identity.messenger == "telegram"
    assert identity.messenger_id == "123456789"
    assert identity.display_name == "Mila Petrović"
    assert identity.messenger_login == "@milap"
    assert identity.photo_url == "https://t.me/i/userpic/320/abcdef.jpg"


async def test_id_as_int_accepted(jwks_endpoint, fake_redis):
    """The issuer emits a digit string; an int claim is the same identity."""
    body, _ = _mint({"id": 424242, "sub": "not-the-user-id"})
    identity = await validate_telegram_id_token(body)
    assert identity.messenger_id == "424242"


async def test_sub_is_never_the_identity(jwks_endpoint, fake_redis):
    body, _ = _mint({"id": "777", "sub": "123456789"})
    identity = await validate_telegram_id_token(body)
    assert identity.messenger_id == "777"


async def test_name_falls_back_to_given_family(jwks_endpoint, fake_redis):
    body, _ = _mint({"name": None})
    identity = await validate_telegram_id_token(body)
    assert identity.display_name == "Mila Petrović"


async def test_missing_username_means_no_login(jwks_endpoint, fake_redis):
    body, _ = _mint({"preferred_username": None})
    identity = await validate_telegram_id_token(body)
    assert identity.messenger_login is None


async def test_username_at_prefix_stripped(jwks_endpoint, fake_redis):
    body, _ = _mint({"preferred_username": "@milap"})
    identity = await validate_telegram_id_token(body)
    assert identity.messenger_login == "@milap"


async def test_extra_claims_ignored(jwks_endpoint, fake_redis):
    body, _ = _mint({"phone_number": "+15551234567", "ton": {"wallet": "x"}, "unknown_future": 1})
    identity = await validate_telegram_id_token(body)
    assert identity.messenger_id == "123456789"


async def test_aud_list_containing_client_id(jwks_endpoint, fake_redis):
    body, _ = _mint({"aud": ["other-aud", TEST_CLIENT_ID]})
    identity = await validate_telegram_id_token(body)
    assert identity.messenger_id == "123456789"


# ── picture allowlist ────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("picture", "expected"),
    [
        ("https://cdn4.telesco.pe/u/abcdef.jpg", "https://cdn4.telesco.pe/u/abcdef.jpg"),
        ("https://telesco.pe/u/abcdef.jpg", "https://telesco.pe/u/abcdef.jpg"),
        # The suffix rule must not admit lookalike hosts.
        ("https://evil-telesco.pe/u/abcdef.jpg", None),
        ("https://telesco.pe.evil.example/u.jpg", None),
        ("https://images.example.com/x.jpg", None),
        # http is never acceptable even on an allowed host.
        ("http://t.me/i/userpic/320/x.jpg", None),
        # Bounded like display_name — an oversized URL must not ride
        # into the ticket (allowed host, over the cap).
        ("https://t.me/i/" + "u" * 2100, None),
        # Non-string claims are simply dropped.
        (None, None),
        (12345, None),
    ],
)
async def test_picture_allowlist(jwks_endpoint, fake_redis, picture, expected):
    body, _ = _mint({"picture": picture})
    identity = await validate_telegram_id_token(body)
    assert identity.photo_url == expected


# ── signature / header / claims failures → identical 400 ─────────────


async def test_bad_signature(jwks_endpoint, fake_redis):
    body, _ = _mint(key=_OTHER_KEY)
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)


async def test_alg_none_rejected(jwks_endpoint, fake_redis):
    verifier = new_verifier()
    claims = _claims(nonce_for(verifier))
    header = b64u(json.dumps({"alg": "none", "typ": "JWT", "kid": TEST_KID}).encode())
    payload = b64u(json.dumps(claims).encode())
    body = _body(f"{header}.{payload}.", verifier)
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)


async def test_alg_es256_rejected(jwks_endpoint, fake_redis):
    body, _ = _mint(key=_EC_KEY, algorithm="ES256")
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)


async def test_missing_kid_rejected(jwks_endpoint, fake_redis):
    body, _ = _mint(kid=None)
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)


async def test_non_string_kid_rejected(jwks_endpoint, fake_redis):
    verifier = new_verifier()
    claims = _claims(nonce_for(verifier))
    # PyJWT can't emit a non-string kid — mint by hand.
    header = b64u(json.dumps({"alg": "RS256", "kid": 7}).encode())
    payload = b64u(json.dumps(claims).encode())
    body = _body(f"{header}.{payload}.sig", verifier)
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)


async def test_wrong_issuer(jwks_endpoint, fake_redis):
    body, _ = _mint({"iss": "https://evil.example.com"})
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)


async def test_wrong_audience(jwks_endpoint, fake_redis):
    body, _ = _mint({"aud": "999999999"})
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)


async def test_numeric_audience_rejected(jwks_endpoint, fake_redis):
    body, _ = _mint({"aud": 123456789})
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)


async def test_audience_list_without_client_id(jwks_endpoint, fake_redis):
    body, _ = _mint({"aud": ["other", "another"]})
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)


async def test_expired(jwks_endpoint, fake_redis):
    now = int(time.time())
    body, _ = _mint({"iat": now - 120, "exp": now - 60})
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)


async def test_stale_iat(jwks_endpoint, fake_redis):
    """iat beyond the max-age window — freshness rides on iat, not just
    exp (a wider token TTL must not widen the login window)."""
    now = int(time.time())
    body, _ = _mint({"iat": now - OIDC_TOKEN_MAX_AGE - 2, "exp": now + 30})
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)


async def test_iat_at_max_age_boundary(jwks_endpoint, fake_redis):
    now = int(time.time())
    body, _ = _mint({"iat": now - OIDC_TOKEN_MAX_AGE + 2, "exp": now + 30})
    await validate_telegram_id_token(body)  # must not raise


async def test_future_iat(jwks_endpoint, fake_redis):
    now = int(time.time())
    body, _ = _mint({"iat": now + 300, "exp": now + 330})
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)


@pytest.mark.parametrize("claim", ["iat", "exp"])
async def test_non_numeric_time_claim_is_400_not_500(jwks_endpoint, fake_redis, claim):
    """NaN slips past PyJWT's isinstance check (it is a float) — the
    int() boundary in the validator must keep it a 400, never a 500."""
    verifier = new_verifier()
    claims = _claims(nonce_for(verifier))
    claims[claim] = float("nan")
    body = _body(make_token(claims), verifier)
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)


async def test_nonce_missing(jwks_endpoint, fake_redis):
    verifier = new_verifier()
    claims = _claims("x")
    del claims["nonce"]
    body = _body(make_token(claims), verifier)
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)


async def test_nonce_not_string(jwks_endpoint, fake_redis):
    body, _ = _mint({"nonce": 12345})
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)


async def test_nonce_non_ascii_is_400_not_500(jwks_endpoint, fake_redis):
    body, _ = _mint({"nonce": "привет-как-дела"})
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)


async def test_wrong_verifier(jwks_endpoint, fake_redis):
    """sha256(verifier) must equal the signed nonce — a captured token
    paired with a foreign verifier fails."""
    body, _ = _mint()
    payload = json.loads(body)
    payload["nonceVerifier"] = new_verifier()  # right shape, wrong value
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(json.dumps(payload).encode())


async def test_replay(jwks_endpoint, fake_redis):
    """The nonce is claimed single-use — the exact same body twice."""
    body, _ = _mint()
    await validate_telegram_id_token(body)
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)


async def test_replay_inside_leeway(jwks_endpoint, fake_redis, monkeypatch):
    """jwt.decode accepts a token until exp + leeway, so the nonce
    claim must outlive that whole window — not just exp. exp = now-30
    sits inside the 60s leeway; advancing the clock 2s keeps the token
    valid, and the second submission must still fail."""
    now = int(time.time())
    body, _ = _mint({"iat": now - 40, "exp": now - 30})
    await validate_telegram_id_token(body)

    monkeypatch.setattr(time, "time", lambda: now + 2)
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)


async def test_sub_required(jwks_endpoint, fake_redis):
    body, _ = _mint({"sub": None})
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)


# ── identity claim failures ──────────────────────────────────────────


@pytest.mark.parametrize(
    "bad_id", [None, True, 0, -5, "abc", "0", "", 3.14, "12a", "007", "+42", "٤٢"]
)
async def test_bad_id_claim(jwks_endpoint, fake_redis, bad_id):
    body, _ = _mint({"id": bad_id})
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)


@pytest.mark.parametrize("name", ["", "   ", "x" * 257])
async def test_bad_display_name(jwks_endpoint, fake_redis, name):
    body, _ = _mint({"name": name, "given_name": "", "family_name": ""})
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)


# ── JWKS fetch / refetch / cache policy ──────────────────────────────


async def test_unknown_kid_refetches_once_then_fails(jwks_endpoint, fake_redis):
    body, _ = _mint()
    await validate_telegram_id_token(body)  # warm the cache
    # The cache load was a while ago — an unknown kid now earns one
    # refetch (a just-fetched set would never be re-fetched for a kid
    # it provably lacks).
    jwks_mod._last_attempt_at -= jwks_mod._REFETCH_COOLDOWN + 1

    body, _ = _mint(kid="unknown-kid")
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)
    assert jwks_endpoint.call_count == 2

    body, _ = _mint(kid="another-unknown-kid")
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)
    # Still inside the 60s cooldown — a random-kid flood must not
    # amplify requests against oauth.telegram.org.
    assert jwks_endpoint.call_count == 2


async def test_concurrent_unknown_kid_refetches_once(jwks_endpoint, fake_redis):
    """Two concurrent unknown-kid validations trigger exactly one
    refetch between them: the budget is armed synchronously before the
    await, so the loser sees the armed window instead of a second
    request."""
    body, _ = _mint()
    await validate_telegram_id_token(body)  # warm the cache
    jwks_mod._last_attempt_at -= jwks_mod._REFETCH_COOLDOWN + 1
    calls_after_warm = jwks_endpoint.call_count

    results = await asyncio.gather(
        validate_telegram_id_token(_mint(kid="concurrent-kid-1")[0]),
        validate_telegram_id_token(_mint(kid="concurrent-kid-2")[0]),
        return_exceptions=True,
    )
    assert all(isinstance(r, TelegramValidationFailedError) for r in results)
    assert jwks_endpoint.call_count == calls_after_warm + 1


async def test_cold_start_concurrent_logins_share_one_fetch(jwks_endpoint, fake_redis):
    """Eight concurrent validations on an empty cache share a single
    in-flight JWKS fetch — one upstream request, not eight."""
    results = await asyncio.gather(
        *(validate_telegram_id_token(_mint()[0]) for _ in range(8)),
        return_exceptions=True,
    )
    assert all(not isinstance(r, Exception) for r in results)
    assert jwks_endpoint.call_count == 1


async def test_empty_cache_outage_fast_fails_inside_cooldown(jwks_endpoint, fake_redis):
    """A failed cold-start fetch throttles sequential retries: inside
    the short failure window logins fail closed without paying the fetch
    timeout; after it the next request tries again."""
    jwks_endpoint.mock(return_value=httpx.Response(503, text="down"))
    body, _ = _mint()
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)
    assert jwks_endpoint.call_count == 1

    body, _ = _mint()
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)
    assert jwks_endpoint.call_count == 1  # fast-failed, no second fetch

    jwks_mod._last_attempt_at -= jwks_mod._FAILED_COOLDOWN + 1
    body, _ = _mint()
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)
    assert jwks_endpoint.call_count == 2


async def test_cold_start_concurrent_outage_shares_one_failure(jwks_endpoint, fake_redis):
    """The shared task dedups the failing fetch too: all waiters get the
    same fail-closed outcome off a single upstream request."""
    jwks_endpoint.mock(return_value=httpx.Response(503, text="down"))
    results = await asyncio.gather(
        *(validate_telegram_id_token(_mint()[0]) for _ in range(8)),
        return_exceptions=True,
    )
    assert all(isinstance(r, TelegramValidationFailedError) for r in results)
    assert jwks_endpoint.call_count == 1


async def test_jwks_down_with_empty_cache(jwks_endpoint, fake_redis):
    jwks_endpoint.mock(return_value=httpx.Response(503, text="down"))
    body, _ = _mint()
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)


async def test_jwks_stale_cache_survives_outage(jwks_endpoint, fake_redis, monkeypatch):
    """A stale cached set keeps verifying when the refresh fails —
    a JWKS outage must not take logins down."""
    monkeypatch.setattr(jwks_mod, "_CACHE_TTL", 0.0)
    body, _ = _mint()
    await validate_telegram_id_token(body)

    jwks_endpoint.mock(return_value=httpx.Response(503, text="down"))
    body, _ = _mint()
    await validate_telegram_id_token(body)  # cached key still verifies


async def test_jwks_outage_throttles_failing_fetches(jwks_endpoint, fake_redis, monkeypatch):
    """Persistent outage with an expired cache: the stale set keeps
    serving and failing fetches are throttled to one per cooldown —
    a 5s stall per login is not acceptable."""
    monkeypatch.setattr(jwks_mod, "_CACHE_TTL", 0.0)
    body, _ = _mint()
    await validate_telegram_id_token(body)

    jwks_endpoint.mock(return_value=httpx.Response(503, text="down"))
    body, _ = _mint()
    await validate_telegram_id_token(body)  # stale fallback, cooldown armed
    calls_after_outage = jwks_endpoint.call_count

    for _ in range(3):
        body, _ = _mint()
        await validate_telegram_id_token(body)
    assert jwks_endpoint.call_count == calls_after_outage


async def test_jwks_fresh_boot_fetches_and_never_double_fetches(
    jwks_endpoint, fake_redis, monkeypatch
):
    """A fresh serverless instance sees monotonic() < _REFETCH_COOLDOWN
    (it counts from boot, not epoch): the empty cache must still fetch —
    the attempt budget only exists once a set is cached. And a set that
    was just fetched is never re-fetched for an unknown kid, so a cold
    start costs one JWKS request, not two."""
    monkeypatch.setattr(time, "monotonic", lambda: 10.0)
    body, _ = _mint()
    await validate_telegram_id_token(body)  # cold fetch runs at t=10
    calls_after_warm = jwks_endpoint.call_count

    body, _ = _mint(kid="fresh-boot-kid")
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)
    assert jwks_endpoint.call_count == calls_after_warm


async def test_alg_mismatch_with_non_rsa_kid_is_400(jwks_endpoint, fake_redis):
    """A forged header can claim alg=RS256 while its kid points at a
    non-RSA entry of the mixed live JWKS. decode must get the PyJWK so
    alg is checked against the key's own algorithm (bad_alg → 400);
    feeding the raw EC key to RSAAlgorithm.prepare_key raises TypeError
    (→ 500)."""
    ec_jwk = jwt.algorithms.ECAlgorithm.to_jwk(_EC_KEY.public_key(), as_dict=True)
    ec_jwk["kid"] = "ec-kid"
    jwks_endpoint.mock(return_value=httpx.Response(200, json=_jwk_set(extra_keys=[ec_jwk])))

    body, _ = _mint(kid="ec-kid")  # RS256 header, kid → the EC entry
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)


async def test_jwks_malformed_body(jwks_endpoint, fake_redis):
    jwks_endpoint.mock(return_value=httpx.Response(200, json={"keys": []}))
    body, _ = _mint()
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)


async def test_jwks_non_json_content_type(jwks_endpoint, fake_redis):
    jwks_endpoint.mock(
        return_value=httpx.Response(200, text="<html>", headers={"content-type": "text/html"})
    )
    body, _ = _mint()
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)


async def test_jwks_oversized_body(jwks_endpoint, fake_redis):
    big = {"keys": [{"kty": "RSA", "kid": "x", "n": "A" * (64 * 1024), "e": "AQAB"}]}
    jwks_endpoint.mock(return_value=httpx.Response(200, json=big))
    body, _ = _mint()
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)


async def test_jwks_gzip_encoded(jwks_endpoint, fake_redis):
    raw = gzip.compress(json.dumps(_jwk_set()).encode())
    jwks_endpoint.mock(
        return_value=httpx.Response(
            200,
            content=raw,
            headers={"content-type": "application/json", "content-encoding": "gzip"},
        )
    )
    body, _ = _mint()
    await validate_telegram_id_token(body)


async def test_jwks_mixed_usable_unusable_keys(jwks_endpoint, fake_redis):
    """Telegram's live set mixes RS256/ES256/EdDSA/ES256K — unusable
    entries are skipped, not fatal."""
    broken = {"kty": "RSA", "kid": "broken", "n": "!!!", "e": "!!!"}
    jwks_endpoint.mock(
        return_value=httpx.Response(200, json=_jwk_set(extra_keys=[broken, {"junk": 1}]))
    )
    body, _ = _mint()
    await validate_telegram_id_token(body)


# ── infrastructure failures ──────────────────────────────────────────


async def test_redis_down_fails_closed(jwks_endpoint, monkeypatch):
    """The nonce claim is fail-closed (ADR-019): a Redis outage is a
    500, never masked as a validation failure."""
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")

    class _BrokenRedis:
        async def set(self, *a, **k):
            raise ConnectionError("redis down")

    monkeypatch.setattr(redis_mod, "client", lambda: _BrokenRedis())
    body, _ = _mint()
    with pytest.raises(RuntimeError):
        await validate_telegram_id_token(body)


async def test_bot_token_missing(monkeypatch, jwks_endpoint):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "")
    body, _ = _mint()
    with pytest.raises(TelegramNotConfiguredError):
        await validate_telegram_id_token(body)


async def test_bot_token_non_numeric_prefix(monkeypatch, jwks_endpoint):
    """A malformed token cannot produce the expected aud — same
    misconfiguration class as an absent one."""
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "notanumber:whatever")
    body, _ = _mint()
    with pytest.raises(TelegramNotConfiguredError):
        await validate_telegram_id_token(body)


async def test_malformed_body_wins_over_missing_token(monkeypatch):
    """Body decode precedes the config check: garbage in is a 400 even
    on a deployment where the 500 (missing TELEGRAM_BOT_TOKEN) is also
    true — 500 must mean the *server* is broken."""
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "")
    with pytest.raises(TelegramInvalidError):
        await validate_telegram_id_token(b"not json")


# ── malformed request body → telegramInvalid ─────────────────────────


async def test_malformed_body(jwks_endpoint):
    cases = [
        b"",
        b"nope",
        b"[1,2]",
        b"{}",
        b'{"idToken":"x"}',
        b'{"nonceVerifier":"' + b"a" * 43 + b'"}',
        # nonceVerifier off-pattern: wrong length, non-base64url, padded.
        b'{"idToken":"x.y.z","nonceVerifier":"short"}',
        b'{"idToken":"x.y.z","nonceVerifier":"' + b"a" * 42 + b'+"}',
        b'{"idToken":"x.y.z","nonceVerifier":"' + b"a" * 43 + b'="}',
        # idToken over the 8 KiB bound.
        b'{"idToken":"' + b"x" * 8193 + b'","nonceVerifier":"' + b"a" * 43 + b'"}',
    ]
    for body in cases:
        with pytest.raises(TelegramInvalidError):
            await validate_telegram_id_token(body)


async def test_malformed_jwt_is_validation_failed(jwks_endpoint):
    """A body that passes the schema but carries an undecodable token:
    400 telegramValidationFailed, never a 500."""
    body = _body("not-a-jwt", new_verifier())
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(body)


# ── logging ──────────────────────────────────────────────────────────


async def test_logs_never_leak_token_or_verifier(jwks_endpoint, fake_redis, log_capture):
    body, verifier = _mint()
    payload = json.loads(body)
    payload["nonceVerifier"] = new_verifier()  # force nonce_mismatch
    with pytest.raises(TelegramValidationFailedError):
        await validate_telegram_id_token(json.dumps(payload).encode())
    token = payload["idToken"]
    assert not _logged(token, log_capture.lines)
    assert not _logged(verifier, log_capture.lines)
    assert any('"reason": "nonce_mismatch"' in line for line in log_capture.lines)


async def test_repeated_failure_reasons_rate_limited(jwks_endpoint, fake_redis, log_capture):
    for _ in range(3):
        body, _ = _mint({"iss": "https://evil.example.com"})
        with pytest.raises(TelegramValidationFailedError):
            await validate_telegram_id_token(body)
    warns = [ln for ln in log_capture.lines if '"level": "WARN"' in ln and "bad_iss" in ln]
    assert len(warns) == 1
