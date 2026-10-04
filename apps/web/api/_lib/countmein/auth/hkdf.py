"""HKDF-SHA256 (RFC 5869) — the one key-derivation primitive the auth
modules share: the organizer session token and the internal service
secret both derive purpose-bound keys from AUTH_SECRET. Mirrors Node's
crypto.hkdfSync('sha256', secret, salt, info, 32); parity is pinned by
the golden vectors in the session/internal-secret tests.
"""

from __future__ import annotations

import hashlib
import hmac

HKDF_SALT = "countmein"
HKDF_LEN = 32


def hkdf_sha256(secret: str, info: str) -> bytes:
    """Extract-then-expand for one 32-byte block (HKDF_LEN ≤ hash size,
    so a single T(1) step suffices)."""
    # Extract: PRK = HMAC-SHA256(salt, IKM).
    prk = hmac.new(HKDF_SALT.encode(), secret.encode(), hashlib.sha256).digest()
    # Expand: T(1) = HMAC-SHA256(PRK, info || 0x01).
    return hmac.new(prk, info.encode() + b"\x01", hashlib.sha256).digest()[:HKDF_LEN]
