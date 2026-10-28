"""Server-side validation of a Telegram OIDC id_token (ADR-026, amends
ADR-008 — replaces the legacy widget HMAC).

The page hashes a local random verifier into the `nonce` handed to
Telegram and POSTs `{idToken, nonceVerifier}`. Here the JWT is verified
against Telegram's JWKS (auth/jwks.py), `sha256(nonceVerifier)` must
equal the `nonce` claim, and the nonce is claimed single-use in Redis.
Every failure answers the same 400 `telegramValidationFailed` — the real
cause is only a `reason` log field; an attacker must not learn more.

Claims are attacker-controlled until the signature verifies; only the
returned identity may be persisted. The numeric `id` claim equals the
legacy widget's telegram user id — `messenger_id` continuity, no DB
migration.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import time
from base64 import urlsafe_b64encode
from dataclasses import dataclass
from typing import Any, NoReturn
from urllib.parse import urlsplit

import jwt

from .. import logx
from ..contracts.payloads import AuthTicketPayload
from ..errors import (
    TelegramInvalidError,
    TelegramNotConfiguredError,
    TelegramValidationFailedError,
    ValidationFailed,
)
from ..validation.decode import decode_telegram_id_token_input
from ..validation.rules import valid_url
from . import jwks
from .ticket import claim_oidc_nonce

_ISSUER = "https://oauth.telegram.org"

# Upper bound on now - iat: the token's own exp (~30s) is the real
# bound, but the legacy path checked auth_date freshness the same way —
# a login proof must be fresh even if Telegram ever widens token TTL.
OIDC_TOKEN_MAX_AGE = 600
# How far iat may lie in the future: clock skew only. At today's
# _JWT_LEEWAY jwt.decode's own iat check already enforces this bound —
# the manual check deliberately stays a second line if leeway changes.
OIDC_FUTURE_SKEW = 60
_JWT_LEEWAY = 60

# Display-name bound: persisted on the organizer row at registration.
_DISPLAY_NAME_MAX = 256
# Same bound treatment as display_name: a hostile URL must not carry an
# unbounded string into the ticket (and from there into photo_url).
_PICTURE_URL_MAX = 2048

# Avatar hosts: the issuer serves t.me/i/userpic/… for `picture`.
# telesco.pe is Telegram's CDN — allowed defensively in case avatars
# move there; subdomains matched by suffix, never a bare endswith
# (evil-telesco.pe must not pass).
_PICTURE_HOSTS_EXACT = frozenset({"t.me", "telesco.pe"})
_PICTURE_HOST_SUFFIXES = (".telesco.pe",)


@dataclass
class TelegramIdentity:
    """A validated Telegram identity mapped onto the fields the app
    speaks (messenger + messengerId, ADR-008) rather than Telegram's own
    claim names."""

    messenger: str
    messenger_id: str
    display_name: str
    photo_url: str | None = None
    messenger_login: str | None = None

    def to_ticket_payload(self, purpose: str) -> AuthTicketPayload:
        """`purpose` binds the ticket to one flow — the consuming guard
        rejects a ticket minted for the other flow."""
        return AuthTicketPayload(
            messenger=self.messenger,
            messenger_id=self.messenger_id,
            display_name=self.display_name,
            photo_url=self.photo_url,
            messenger_login=self.messenger_login,
            purpose=purpose,
        )


# Ticket purposes: a ticket minted for one flow must not be redeemable
# in another.
TICKET_PURPOSE_GUEST = "guest"
TICKET_PURPOSE_ORGANIZER = "organizer"


def _fail(reason: str, **fields: object) -> NoReturn:
    """Every token-level failure answers identically; the real cause is
    rate-limited telemetry only."""
    logx.warn_every(
        300,
        f"telegram id_token rejected: {reason}",
        {"scope": "telegram-auth", "reason": reason, **fields},
    )
    raise TelegramValidationFailedError()


def _jwt_error_reason(err: jwt.PyJWTError) -> str:
    if isinstance(err, jwt.ExpiredSignatureError):
        return "expired"
    if isinstance(err, jwt.InvalidAudienceError):
        return "bad_aud"
    if isinstance(err, jwt.InvalidIssuerError):
        return "bad_iss"
    if isinstance(err, jwt.ImmatureSignatureError):
        return "future_iat"
    if isinstance(err, jwt.InvalidIssuedAtError):
        return "bad_iat"
    if isinstance(err, jwt.InvalidAlgorithmError):
        return "bad_alg"
    if isinstance(err, jwt.MissingRequiredClaimError):
        return "nonce_missing" if err.claim == "nonce" else "missing_claim"
    if isinstance(err, jwt.InvalidSignatureError):
        return "bad_sig"
    if isinstance(err, jwt.DecodeError):
        return "malformed"
    return "invalid"


def _client_id() -> str:
    """Expected `aud`: the Client ID is the numeric bot id — the
    TELEGRAM_BOT_TOKEN prefix. next.config.js keeps the public client
    id in sync at build time."""
    bot_token = os.getenv("TELEGRAM_BOT_TOKEN", "")
    prefix = bot_token.strip().partition(":")[0]
    if prefix == "" or not prefix.isascii() or not prefix.isdigit():
        raise TelegramNotConfiguredError()
    return prefix


def _b64url_nopad(raw: bytes) -> bytes:
    return urlsafe_b64encode(raw).rstrip(b"=")


def _str_or_empty(v: Any) -> str:
    return v if isinstance(v, str) else ""


def _picture_url(claims: dict[str, Any]) -> str | None:
    """The `picture` claim as a storable photo_url, or None. An odd URL
    never fails a valid login — it just means no avatar."""
    url = _str_or_empty(claims.get("picture")).strip()
    if url == "" or len(url) > _PICTURE_URL_MAX or not valid_url(url):
        return None
    # valid_url already enforced http(s)+netloc — narrow to https on an
    # allowed host.
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if parts.scheme == "https" and (
        host in _PICTURE_HOSTS_EXACT or host.endswith(_PICTURE_HOST_SUFFIXES)
    ):
        return url
    return None


async def _verify_jwt(token: str, verifier: str, client_id: str) -> tuple[dict[str, Any], str, int]:
    """Verify the id_token end to end: header → JWKS key → signature and
    registered claims → iat freshness → nonce bound to the verifier.
    Returns (claims, nonce, exp) on success; every failure is a
    TelegramValidationFailedError with a `reason` for the logs."""
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        _fail("malformed")
    kid = header.get("kid")
    if not isinstance(kid, str) or kid == "":
        _fail("unknown_kid")

    signing_key = await jwks.get_signing_key(kid)
    if signing_key is None:
        _fail("unknown_kid")

    try:
        claims: dict[str, Any] = jwt.decode(
            token,
            # PyJWK, not .key: PyJWT then checks the alg header against
            # the key's own algorithm — a forged header pointing at a
            # non-RSA kid would otherwise TypeError in prepare_key (500).
            key=signing_key,
            algorithms=["RS256"],
            audience=client_id,
            issuer=_ISSUER,
            leeway=_JWT_LEEWAY,
            options={"require": ["exp", "iat", "iss", "aud", "sub", "nonce"]},
        )
    except jwt.PyJWTError as err:
        # missing_claim is which-claim-blind — name it in the log fields.
        extra = {"claim": err.claim} if isinstance(err, jwt.MissingRequiredClaimError) else {}
        _fail(_jwt_error_reason(err), **extra)

    now = int(time.time())
    try:
        iat = int(claims["iat"])
        exp = int(claims["exp"])
    except (TypeError, ValueError, OverflowError):
        # PyJWT lets non-numerics like NaN through isinstance — keep
        # this a 400, never a 500.
        _fail("bad_iat")
    if now - iat > OIDC_TOKEN_MAX_AGE:
        _fail("stale_iat")
    if now - iat < -OIDC_FUTURE_SKEW:
        _fail("future_iat")

    # Proof-of-possession: nonce = b64url(sha256(verifier)) — a token
    # captured elsewhere is useless without the page-local verifier.
    nonce = claims["nonce"]
    if not isinstance(nonce, str):
        _fail("nonce_type")
    try:
        nonce_bytes = nonce.encode("ascii")
        # The verifier is attacker-supplied — a non-ASCII value must be
        # a 400, never a 500.
        verifier_bytes = verifier.encode("ascii")
    except UnicodeEncodeError:
        _fail("nonce_type")
    expected = _b64url_nopad(hashlib.sha256(verifier_bytes).digest())
    if not hmac.compare_digest(expected, nonce_bytes):
        _fail("nonce_mismatch")
    return claims, nonce, exp


def _identity_from_claims(claims: dict[str, Any]) -> TelegramIdentity:
    """Map verified claims to our identity. `id` — not `sub` — is the
    telegram user id; int and digit-string shapes are accepted."""
    raw_id = claims.get("id")
    if isinstance(raw_id, bool):
        _fail("bad_id")
    if isinstance(raw_id, int) and raw_id > 0:
        messenger_id = str(raw_id)
    elif (
        isinstance(raw_id, str)
        and raw_id.isdigit()
        and str(int(raw_id)) == raw_id  # canonical: no leading zeros/signs/non-ASCII
        and int(raw_id) > 0
    ):
        messenger_id = raw_id
    else:
        _fail("bad_id")

    display_name = (
        _str_or_empty(claims.get("name"))
        or f"{_str_or_empty(claims.get('given_name'))} {_str_or_empty(claims.get('family_name'))}"
    ).strip()
    if display_name == "" or len(display_name) > _DISPLAY_NAME_MAX:
        _fail("bad_name")

    messenger_login: str | None = None
    username = _str_or_empty(claims.get("preferred_username")).strip().lstrip("@")
    if username != "":
        # Same bound as display_name — an oversized claim must not
        # stuff unbounded text into tickets and bookings.
        messenger_login = ("@" + username)[:_DISPLAY_NAME_MAX]

    return TelegramIdentity(
        messenger="telegram",
        messenger_id=messenger_id,
        display_name=display_name,
        photo_url=_picture_url(claims),
        messenger_login=messenger_login,
    )


async def validate_telegram_id_token(body: bytes) -> TelegramIdentity:
    """Decode the body, verify the id_token against Telegram's JWKS,
    bind it to the page's nonce verifier, and claim the nonce
    single-use. TelegramNotConfiguredError (500), TelegramInvalidError
    (400 telegramInvalid) for a malformed body, or
    TelegramValidationFailedError (400) for any token/nonce check."""
    # Body decode first: a malformed body is a 400 even misconfigured —
    # 500 must mean the *server* is broken.
    try:
        payload = decode_telegram_id_token_input(body)
    except ValidationFailed:
        raise TelegramInvalidError() from None

    claims, nonce, exp = await _verify_jwt(payload.idToken, payload.nonceVerifier, _client_id())
    identity = _identity_from_claims(claims)

    # Claimed last: the nonce is consumed only by a token that yielded
    # an identity, and junk never touches Redis. The ttl covers the whole
    # acceptance window (exp + leeway) — a replay inside it is caught.
    ttl = max(1, exp - int(time.time()) + _JWT_LEEWAY)
    if not await claim_oidc_nonce(nonce, ttl=ttl):
        _fail("replay")

    return identity
