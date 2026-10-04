"""Internal service auth verification."""

from __future__ import annotations

import hmac
import os

from .hkdf import hkdf_sha256

INTERNAL_SECRET_HEADER = "x-internal-secret"  # noqa: S105
HKDF_INFO = "CountMeIn Internal Service Key v1"


def derived_internal_secret(auth_secret: str) -> str:
    """Derive the HMAC-SHA256 internal key from AUTH_SECRET via HKDF-SHA256."""
    return hkdf_sha256(auth_secret, HKDF_INFO).hex()


def verify_internal_secret(given_secret: str | None) -> bool:
    """Verify in constant time against the derived internal secret.

    Compared as bytes: a latin-1 header can carry code points >127 where
    compare_digest on str raises TypeError — a 500, not a clean 401."""
    if not given_secret:
        return False
    auth_secret = os.getenv("AUTH_SECRET", "")
    if not auth_secret:
        return False
    expected = derived_internal_secret(auth_secret)
    return hmac.compare_digest(given_secret.encode(), expected.encode())
