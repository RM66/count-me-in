"""Organizer session resolution.

The API does not decrypt the Auth.js session cookie. Instead, the
Next.js edge middleware (proxy.ts) mints a short-lived HS256 JWT into
the X-Organizer-Auth header for every /api/* request from a signed-in
organizer. This is a stable, self-controlled format — not @auth/core's
internal JWE wire format, which a minor Auth.js upgrade could change
silently.

The token: HS256, compact JWT, claims { sub, slug, iat, exp }, 60s
TTL. **No separate secret**: the signing key is derived from the
existing AUTH_SECRET via HKDF-SHA256 (RFC 5869) with a purpose-bound
info string — the same key-separation pattern Auth.js itself uses.
Deriving (rather than reusing the raw secret) keeps the two protocols
independent; rotating AUTH_SECRET rotates both at once. The derivation
parameters must match src/server/auth/organizer-token.ts exactly;
parity is pinned by the golden vector in the session tests.

Verified with stdlib crypto only.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass
from typing import Any

from starlette.requests import Request

from .. import logx

# The HTTP header carrying the organizer-auth JWT.
ORGANIZER_AUTH_HEADER = "x-organizer-auth"

# HKDF derivation parameters — must match organizer-token.ts exactly.
HKDF_SALT = "countmein"
HKDF_INFO = "CountMeIn Organizer API Token Key v1"
HKDF_LEN = 32

# No warn-once here: on a warmed serverless instance a once-per-process
# log line makes a persistent misconfiguration nearly invisible.
# warn_every keeps a heartbeat in the logs instead.
_WARN_INTERVAL = 300  # seconds

_B64 = base64.urlsafe_b64encode


@dataclass(frozen=True)
class Session:
    """The organizer identity extracted from the organizer-auth token:
    Organizer.id IS the Auth.js user id (sub claim)."""

    organizer_id: str
    slug: str


def _b64decode(s: str) -> bytes:
    # Raw base64url (no padding) — tolerate missing padding.
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def derived_signing_key(secret: str) -> bytes:
    """Derive the HMAC-SHA256 signing key from AUTH_SECRET via
    HKDF-SHA256 (RFC 5869), extract-then-expand. Mirrors Node's
    crypto.hkdfSync('sha256', secret, salt, info, 32) — parity pinned by
    the golden vector in the session tests."""
    # Extract: PRK = HMAC-SHA256(salt, IKM).
    prk = hmac.new(HKDF_SALT.encode(), secret.encode(), hashlib.sha256).digest()
    # Expand: T(1) = HMAC-SHA256(PRK, info || 0x01); 32 bytes = one block.
    return hmac.new(prk, HKDF_INFO.encode() + b"\x01", hashlib.sha256).digest()[:HKDF_LEN]


def verify_organizer_auth(token: str, secret: str) -> dict[str, Any] | None:
    """Validate an HS256 compact JWT and return its claims. The clock
    tolerance matches the old JWE decoder (15s)."""
    parts = token.split(".")
    if len(parts) != 3:
        return None

    # Verify the signature before trusting any claim.
    sig = hmac.new(
        derived_signing_key(secret), f"{parts[0]}.{parts[1]}".encode(), hashlib.sha256
    ).digest()
    expected_sig = _B64(sig).rstrip(b"=").decode()
    if not hmac.compare_digest(expected_sig, parts[2]):
        return None

    try:
        header = json.loads(_b64decode(parts[0]))
        claims = json.loads(_b64decode(parts[1]))
    except ValueError:
        return None
    if header.get("alg") != "HS256":
        return None
    if not isinstance(claims, dict) or not claims.get("sub"):
        return None

    # Expiry (15s clock tolerance, matching the old decoder). exp is
    # required: a token without it used to be treated as non-expiring,
    # but the mint always sets it — an absent exp means a forged or
    # malformed token, not a legacy one.
    exp = claims.get("exp", 0)
    if exp == 0 or int(time.time()) - 15 > exp:
        return None
    return claims


def session_from_request(request: Request) -> Session | None:
    """Read the organizer-auth header and verify the JWT. Returns None
    when there is no session (anonymous → demo cabinet visitor, ADR-010)
    or when the token cannot be verified."""
    secret = os.getenv("AUTH_SECRET", "")
    if secret == "":
        logx.warn_every(_WARN_INTERVAL, "AUTH_SECRET is not set — every request is anonymous", None)
        return None

    token = request.headers.get(ORGANIZER_AUTH_HEADER, "")
    if token == "":
        return None

    claims = verify_organizer_auth(token, secret)
    if claims is None:
        logx.warn_every(
            _WARN_INTERVAL,
            "organizer-auth token present but invalid (AUTH_SECRET mismatch or expiry)",
            None,
        )
        return None
    return Session(organizer_id=claims["sub"], slug=claims.get("slug", ""))


def session_organizer_id(request: Request) -> str:
    """The organizer id behind the request, or "" when anonymous."""
    s = session_from_request(request)
    if s is not None:
        return s.organizer_id
    return ""
