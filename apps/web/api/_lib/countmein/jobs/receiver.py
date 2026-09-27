"""QStash signature verification, delegated to the official
`qstash` package (the same `@upstash/qstash` Receiver the TS side used).

The upstash-signature header is a JWT:

- HS256 over "header.payload", the secret being the raw UTF-8 bytes of
  the current or next signing key. The algorithm is pinned by the
  verifier (algorithms=["HS256"]): a forged header must not be able to
  pick its own algorithm;
- issuer claim "Upstash";
- exp/nbf claims required and checked with a 60s clock tolerance
  (function clocks may lag seconds behind the signer);
- body claim = base64url(SHA-256(request body));
- sub claim binds the token to this deployment's destination URL.

Key handling rules (the security-critical part):

- An empty signing key is never tried. HMAC-SHA256 with an empty key is
  computable by anyone, so a token forged with `""` as the secret must
  not verify — `QSTASH_NEXT_SIGNING_KEY` is optional and empty outside
  QStash's rotation window, and trying it would accept forgeries.
- If both keys are empty, nothing can verify.
"""

from __future__ import annotations

from collections.abc import Mapping

# Clock tolerance on the exp/nbf claims: QStash mints exp at sign time
# and the function clock may lag seconds behind.
_QSTASH_EXP_SKEW = 60


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
    replayed here. APP_URL is validated at cold start (config.validate),
    so the sub check is never skipped.
    """
    if signature == "":
        return False
    # Never verify with an empty key: HMAC with "" is computable by
    # anyone, so an empty next key must be skipped, not tried.
    keys = [k for k in (current_signing_key, next_signing_key) if k]
    if not keys:
        return False
    # Lazy import: the cold-start rule (tests_py/test_cold_imports.py)
    # forbids pulling qstash in at module import time.
    from qstash.errors import SignatureError
    from qstash.receiver import verify_with_key

    # Strict UTF-8: QStash only ever delivers JSON, so non-UTF-8 bytes
    # are not a delivery we signed. The SDK re-encodes the body string
    # with strict UTF-8 to compute the hash, so a lenient decode here
    # (surrogateescape) would turn into UnicodeEncodeError inside the
    # SDK — a 500 that burns QStash's retry budget on garbage.
    try:
        body_text = body.decode("utf-8")
    except UnicodeDecodeError:
        return False
    for key in keys:
        try:
            verify_with_key(
                key,
                signature=signature,
                body=body_text,
                url=expected_sub,
                clock_tolerance=_QSTASH_EXP_SKEW,
            )
            return True
        except (SignatureError, KeyError, AttributeError, UnicodeError):
            # KeyError: a validly-signed token without a body claim —
            # the SDK indexes claims["body"] directly. AttributeError:
            # the claim present but not a string (the SDK calls
            # .rstrip on it). Both are malformed deliveries (QStash
            # always sets a string body claim), so they must fail
            # verification (401), not crash the route (500, which
            # would burn QStash's retry budget on garbage).
            continue
    return False


def trace_id_from_headers(headers: Mapping[str, str]) -> str:
    """Read the trace-id header forwarded by QStash. The publisher sets
    Upstash-Trace-Id on the publish request; QStash forwards Upstash-*
    headers to the destination. Returns "" when absent (sweeper
    re-publish, legacy)."""
    for name, value in headers.items():
        if name.lower() == "upstash-trace-id":
            return value
    return ""
