"""QStash signature verification (port of @upstash/qstash@2.11.3's
Receiver, which verifies via jose with the signing key as the HMAC
secret). The upstash-signature header is a JWT:

- HS256 over "header.payload", the secret being the raw UTF-8 bytes of
  the current or next signing key. The algorithm is pinned: this
  account's QStash signs HS256, and accepting HS384/HS512 with the same
  secret only widens the surface — a forged header must not be able to
  pick its own algorithm;
- issuer claim "Upstash";
- exp claim checked with a 60s clock tolerance (function clocks may lag
  seconds behind the signer; skew use is logged throttled);
- body claim = base64url(SHA-256(request body)); trailing "=" padding
  stripped on both sides before comparing.

Try current_signing_key first, then next_signing_key (key rotation).
The signature comparison is over the raw decoded bytes, not the base64
strings — comparing encoded strings leaks length before content."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from collections.abc import Mapping
from dataclasses import dataclass

from .. import logx

# Clock tolerance on the exp claim: QStash mints exp at sign time and
# the function clock may lag seconds behind. A token past exp but within
# the skew still verifies (with a throttled log so skew use is visible
# in metrics); past exp+skew it is dead.
_QSTASH_EXP_SKEW = 60


@dataclass(frozen=True)
class _Claims:
    iss: str = ""
    sub: str = ""
    exp: int = 0
    nbf: int = 0
    body: str = ""


def _b64url_decode(part: str) -> bytes | None:
    try:
        return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))
    except (ValueError, TypeError):
        return None


def _verify_with_key(signature: str, key: str) -> _Claims | None:
    parts = signature.split(".")
    if len(parts) != 3:
        return None
    header_raw = _b64url_decode(parts[0])
    if header_raw is None:
        return None
    try:
        header = json.loads(header_raw)
    except ValueError:
        return None
    # Algorithm pinned to HS256: this account's QStash signs HS256, and a
    # verifier that honors whatever alg the (attacker-supplied) header
    # names invites algorithm-confusion. aud/typ are not checked —
    # QStash does not set them meaningfully for this flow.
    if not isinstance(header, dict) or header.get("alg") != "HS256":
        return None
    expected = hmac.new(
        key.encode("utf-8"),
        (parts[0] + "." + parts[1]).encode("utf-8"),
        hashlib.sha256,
    ).digest()
    got = _b64url_decode(parts[2])
    # Compare raw decoded bytes — comparing the base64 strings would
    # leak the encoded length before the content.
    if got is None or not hmac.compare_digest(expected, got):
        return None

    claims_raw = _b64url_decode(parts[1])
    if claims_raw is None:
        return None
    try:
        claims_json = json.loads(claims_raw)
    except ValueError:
        return None
    if not isinstance(claims_json, dict):
        return None
    claims = _Claims(
        iss=str(claims_json.get("iss") or ""),
        sub=str(claims_json.get("sub") or ""),
        exp=int(claims_json.get("exp") or 0),
        nbf=int(claims_json.get("nbf") or 0),
        body=str(claims_json.get("body") or ""),
    )
    # jose checks: issuer must match; exp/nbf honored (0 clock
    # tolerance, mirroring the TS route).
    if claims.iss != "Upstash":
        return None
    now = int(time.time())
    if claims.exp != 0:
        skew = now - claims.exp
        if skew > _QSTASH_EXP_SKEW:
            return None
        if skew > 0:
            logx.warn_every(
                5 * 60,
                "qstash signature accepted within exp skew",
                {"skewS": skew},
            )
    if claims.nbf != 0 and now < claims.nbf:
        return None
    return claims


def verify_qstash_signature(
    body: bytes,
    signature: str,
    current_signing_key: str,
    next_signing_key: str,
    expected_sub: str,
) -> bool:
    """Check a delivery's upstash-signature against the raw body bytes.
    The signature covers the exact bytes of the body, so callers must
    pass them unmodified. expected_sub binds the token to this
    deployment's destination URL ({APP_URL}/api/jobs/{queue}): the
    signing keys are account-scoped, so without the check a delivery
    signed for another destination in the same QStash account could be
    replayed here. Empty expected_sub skips the check (tests, legacy)."""
    if signature == "":
        return False
    claims = _verify_with_key(signature, current_signing_key)
    if claims is None:
        claims = _verify_with_key(signature, next_signing_key)
    if claims is None:
        return False
    # Destination binding: the sub claim names the URL QStash was told
    # to deliver to. A token minted for a different destination in the
    # same account must not verify here.
    if expected_sub != "" and claims.sub != expected_sub:
        return False
    # Body hash: base64url(SHA-256(body)), padding-insensitive compare.
    body_hash = base64.urlsafe_b64encode(hashlib.sha256(body).digest()).rstrip(b"=").decode("ascii")
    if claims.body.rstrip("=") != body_hash:
        return False
    return True


def trace_id_from_headers(headers: Mapping[str, str]) -> str:
    """Read the trace-id header forwarded by QStash. The publisher sets
    Upstash-Trace-Id on the publish request; QStash forwards Upstash-*
    headers to the destination. Returns "" when absent (sweeper
    re-publish, legacy)."""
    for name, value in headers.items():
        if name.lower() == "upstash-trace-id":
            return value
    return ""
