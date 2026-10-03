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

# Clock tolerance on exp/nbf: the function clock may lag seconds behind
# the signer.
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
    # Never verify with an empty key — HMAC with "" is computable by
    # anyone.
    keys = [k for k in (current_signing_key, next_signing_key) if k]
    if not keys:
        return False
    # Lazy import: the cold-start rule (tests_py/test_cold_imports.py)
    # forbids pulling qstash in at module import time.
    from qstash.errors import SignatureError
    from qstash.receiver import verify_with_key

    # Strict UTF-8: QStash only delivers JSON. A lenient decode would
    # turn into UnicodeEncodeError inside the SDK — a 500 that burns
    # the retry budget on garbage.
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
            # KeyError: signed token without a body claim (the SDK
            # indexes claims["body"]). AttributeError: the claim is not
            # a string (the SDK calls .rstrip on it). Both are malformed
            # deliveries — fail verification (401), never a 500 that
            # burns the retry budget.
            continue
    return False


def trace_id_from_headers(headers: Mapping[str, str]) -> str:
    """Read the trace-id header QStash forwarded (the publisher sets
    Upstash-Trace-Id; Upstash-* headers reach the destination).
    "" when absent (sweeper re-publish, legacy)."""
    for name, value in headers.items():
        if name.lower() == "upstash-trace-id":
            return value
    return ""
