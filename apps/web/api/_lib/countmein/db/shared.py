"""Shared data-layer helpers: SQLSTATE classification, id/token
generation, the manage-token hash, and the merge-patch update contract.

The manage-token hash is a fixed contract: SHA-256 hex, pinned by the
domain vector tests_py/vectors/domain/hashManageToken.json (ADR-020).
"""

from __future__ import annotations

import base64
import hashlib
import secrets
import time

from sqlalchemy.exc import IntegrityError

# Postgres SQLSTATE codes the driver puts on a constraint rejection.
UNIQUE_VIOLATION = "23505"
FOREIGN_KEY_VIOLATION = "23503"


def _sqlstate(err: IntegrityError) -> str:
    """The SQLSTATE on the wrapped psycopg error ("" when absent)."""
    return str(getattr(err.orig, "sqlstate", "") or "")


def unique_violation(err: IntegrityError) -> bool:
    """Whether err is a 23505 unique-constraint rejection."""
    return _sqlstate(err) == UNIQUE_VIOLATION


def unique_constraint_name(err: IntegrityError) -> str | None:
    """The constraint name behind a 23505, or None — how a unique
    violation is told apart (slug vs messenger identity)."""
    if _sqlstate(err) != UNIQUE_VIOLATION:
        return None
    diag = getattr(err.orig, "diag", None)
    name = getattr(diag, "constraint_name", None) if diag is not None else None
    return str(name) if name else None


def is_foreign_key_violation(err: IntegrityError) -> bool:
    """Whether err is a 23503 — used as a backstop on delete paths so a
    constraint cannot resurface as a 500."""
    return _sqlstate(err) == FOREIGN_KEY_VIOLATION


def new_id() -> str:
    """Generate a uuidv7 — the tables' ids have no DB default (Drizzle's
    $defaultFn ran JS-side), so ids are generated here.

    RFC 9562: unix_ts_ms (48) | ver=7 (4) | rand_a (12) | var=2 (2) |
    rand_b (62)."""
    ts_ms = time.time_ns() // 1_000_000
    rand = secrets.token_bytes(10)
    b = bytearray(16)
    b[0] = (ts_ms >> 40) & 0xFF
    b[1] = (ts_ms >> 32) & 0xFF
    b[2] = (ts_ms >> 24) & 0xFF
    b[3] = (ts_ms >> 16) & 0xFF
    b[4] = (ts_ms >> 8) & 0xFF
    b[5] = ts_ms & 0xFF
    b[6] = 0x70 | ((rand[0] >> 4) & 0x0F)  # version 7
    b[7] = ((rand[0] & 0x0F) << 4) | ((rand[1] >> 4) & 0x0F)
    b[8] = 0x80 | (rand[1] & 0x0F)  # variant 10xx
    b[9:] = rand[2:10]
    hexed = b.hex()
    return f"{hexed[0:8]}-{hexed[8:12]}-{hexed[12:16]}-{hexed[16:20]}-{hexed[20:32]}"


_NANOID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"


def new_service_id() -> str:
    """Mirror nanoid(): 21 chars from the URL-safe alphabet, with
    rejection sampling — 256 % 64 != 0, so a plain modulo would favour
    the first bytes. Not security-critical, but a faithful port."""
    alphabet_len = 64
    limit = 256 - (256 % alphabet_len)  # largest multiple fitting in a byte
    out: list[str] = []
    while len(out) < 21:
        b = secrets.randbits(8)
        if b >= limit:
            continue  # reject — re-roll
        out.append(_NANOID_ALPHABET[b % alphabet_len])
    return "".join(out)


def new_manage_token() -> str:
    """32 bytes base64url; the credential guarding
    /booking/{manageToken}, never typed by hand."""
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()


def hash_manage_token(token: str) -> str:
    """SHA-256 hex of the manage token — the lookup key for cancel and
    the management page. The raw token is stored only for re-issuing the
    deep link; every credential check goes through this hash."""
    return hashlib.sha256(token.encode()).hexdigest()
