"""Cloudflare R2 media orchestration (avatars, service covers) — signed
direct-browser upload URLs via boto3's S3 presigner (R2 is
S3-compatible, ADR-007).

Key builders and URL mapping, ported from @repo/media-storage/keys. Both
avatars and service covers live under organizers/{organizerId}/, so one
ownership check (organizer_media_url_prefix) covers them.
"""

from __future__ import annotations

import os
import posixpath
import secrets
import threading
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING
from urllib.parse import unquote, urlsplit

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client

from . import logx
from .contracts import models_gen as gen
from .contracts.domain import iso_date

# ── Config (lazy, cached like every other singleton) ─────────────────────────

_ENV_NAMES = (
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
    "R2_PUBLIC_BASE_URL",
)

_cfg: dict[str, str] | None = None
_cfg_err: Exception | None = None


def config() -> dict[str, str]:
    """Validate lazily (raise on first use). The variable list is ordered
    so the reported error is deterministic. No lock needed: the cache is
    only written with env-derived values, and a concurrent write stores
    the same data."""
    global _cfg, _cfg_err
    if _cfg is None and _cfg_err is None:
        _cfg = {
            "account_id": os.getenv("R2_ACCOUNT_ID", ""),
            "access_key_id": os.getenv("R2_ACCESS_KEY_ID", ""),
            "secret_access": os.getenv("R2_SECRET_ACCESS_KEY", ""),
            "bucket": os.getenv("R2_BUCKET", ""),
            "public_base_url": os.getenv("R2_PUBLIC_BASE_URL", ""),
        }
        for name in _ENV_NAMES:
            if os.getenv(name, "") == "":
                _cfg_err = RuntimeError(f"{name} is not set")
                break
    if _cfg_err is not None:
        raise _cfg_err
    if _cfg is None:
        # Unreachable by the decode/guard contract; a real None
        # here is a bug, and python -O must not strip the check.
        raise RuntimeError("_cfg is None after its error guard")
    return _cfg


def reset_for_test() -> None:
    """Drop the cached config AND the S3 client/presigner so the next
    call re-reads env — the client binds the account id at build time,
    so clearing only the config leaves a stale endpoint under a new
    account."""
    global _cfg, _cfg_err, _s3_client, _presigner
    _cfg = None
    _cfg_err = None
    _s3_client = None
    _presigner = None


# ── S3 client + presigner (lazy) ─────────────────────────────────────────────

_s3_client: S3Client | None = None
_presigner: Callable[..., str] | None = None
# boto3.client() builds on the process-wide default session, which is
# not thread-safe. Media cleanup runs in a worker thread (to_thread),
# so two parallel cleanups can race the lazy init — the lock makes the
# check-and-create atomic across threads.
_client_lock = threading.Lock()


def _client() -> S3Client:
    global _s3_client
    if _s3_client is None:
        import boto3
        from botocore.config import Config as BotocoreConfig

        c = config()
        with _client_lock:
            if _s3_client is None:
                _s3_client = boto3.client(
                    "s3",
                    region_name="auto",
                    endpoint_url=f"https://{c['account_id']}.r2.cloudflarestorage.com",
                    aws_access_key_id=c["access_key_id"],
                    aws_secret_access_key=c["secret_access"],
                    # The delete runs in a worker thread inside a 3s
                    # asyncio.timeout, which cannot cancel a thread — the
                    # client's own timeouts guarantee the thread finishes.
                    # total_max_attempts=1: exactly one attempt, no
                    # botocore-internal retries (max_attempts counts
                    # retries *after* the first try, so it would give 2).
                    config=BotocoreConfig(
                        s3={"addressing_style": "path"},
                        connect_timeout=2,
                        read_timeout=2,
                        retries={"total_max_attempts": 1},
                    ),
                )
    if _s3_client is None:
        # Unreachable by the decode/guard contract; a real None
        # here is a bug, and python -O must not strip the check.
        raise RuntimeError("_s3_client is None after its error guard")
    return _s3_client


def _presign_client() -> Callable[..., str]:
    global _presigner
    if _presigner is None:
        _presigner = _client().generate_presigned_url
    return _presigner


# ── Signed URLs and deletes ──────────────────────────────────────────────────

_UPLOAD_TTL = timedelta(minutes=10)


def signed_upload_url(key: str, content_type: str, content_length: int) -> tuple[str, datetime]:
    """Create a signed PUT URL for direct browser upload to R2. The
    signature pins Content-Type and Content-Length, so the browser PUT
    must match them exactly (R2 rejects mismatches)."""
    c = config()
    url = _presign_client()(
        "put_object",
        Params={
            "Bucket": c["bucket"],
            "Key": key,
            "ContentType": content_type,
            "ContentLength": content_length,
        },
        ExpiresIn=int(_UPLOAD_TTL.total_seconds()),
    )
    return url, datetime.now(tz=UTC) + _UPLOAD_TTL


def delete_object(key: str) -> None:
    """Remove an object from R2 by key. A missing object is success (S3
    delete is idempotent), so a stale URL or an already cleaned-up key
    is not an error."""
    if key == "":
        raise ValueError("empty object key")
    c = config()
    _client().delete_object(Bucket=c["bucket"], Key=key)


# ── Key builders and URL mapping ─────────────────────────────────────────────


def ext_for_content_type(content_type: str) -> str:
    if content_type == "image/jpeg":
        return "jpg"
    if content_type == "image/png":
        return "png"
    if content_type == "image/webp":
        return "webp"
    raise ValueError(f"unsupported content type: {content_type}")


def _random_key_suffix() -> str:
    """Mirror randomUUID().slice(0, 8): 8 hex chars."""
    return secrets.token_hex(4)


def avatar_key(organizer_id: str, ext: str) -> str:
    """organizers/{organizerId}/avatar-{random}.{ext}."""
    return f"organizers/{organizer_id}/avatar-{_random_key_suffix()}.{ext}"


def service_photo_key(organizer_id: str, ext: str) -> str:
    """Deliberately organizer-scoped, not services/{serviceId}/…: the
    cover is uploaded from the "new service" form *before* the row (and
    therefore the service id) exists, so the same ownership check
    validates avatars and covers alike."""
    return f"organizers/{organizer_id}/services/photo-{_random_key_suffix()}.{ext}"


def public_url(key: str) -> str:
    """Map an R2 object key to its public URL."""
    return config()["public_base_url"] + "/" + key


def organizer_media_url_prefix(organizer_id: str) -> str:
    """The public URL prefix of everything an organizer owns (avatar
    *and* service covers)."""
    return config()["public_base_url"] + "/organizers/" + organizer_id + "/"


def _clean_path(path: str) -> str:
    """posixpath.normpath on an absolutely-rooted path — the analogue of
    Go's path.Clean("/" + p): resolves `.`/`..` segments, keeps the root.
    Unlike Go, Python's normpath preserves a leading `//`, so the path is
    rooted exactly once."""
    cleaned = posixpath.normpath(path or "/")
    if not cleaned.startswith("/"):
        cleaned = "/" + cleaned
    return cleaned


def is_own_media_url(organizer_id: str, url: str) -> bool:
    """Validate that a client-submitted photoUrl belongs to this
    organizer's prefix — prevents pointing the row at an arbitrary host
    or another organizer's media.

    The check parses the URL and compares host + normalized path: a raw
    prefix comparison lets `…/{id}/../{other}/x` through, because `..`
    segments are resolved by the HTTP client, not by the string. Parsing
    + normpath on the decoded path closes that: the cleaned path must
    stay under the organizer's directory."""
    try:
        prefix = organizer_media_url_prefix(organizer_id)
    except Exception:
        return False
    try:
        parsed = urlsplit(url)
        prefix_url = urlsplit(prefix)
    except ValueError:
        return False
    if parsed.netloc != prefix_url.netloc:
        return False
    # normpath resolves `..` and `.` segments; the result must remain
    # inside the organizer's directory. normpath strips the trailing
    # slash, so the boundary is the directory itself or anything beneath
    # it — a sibling like /organizers/{id}-evil must not match.
    cleaned = _clean_path(unquote(parsed.path))
    own = _clean_path(prefix_url.path).rstrip("/")
    return cleaned == own or cleaned.startswith(own + "/")


def media_key_from_url(organizer_id: str, url: str) -> str | None:
    """The inverse of public_url: map a public media URL back to its R2
    object key. It only accepts URLs under this organizer's own prefix —
    a foreign or malformed URL yields None and the caller must
    skip deletion rather than delete something it does not own."""
    if not is_own_media_url(organizer_id, url):
        return None
    c = config()
    base_url = urlsplit(c["public_base_url"])
    parsed = urlsplit(url)
    cleaned = _clean_path(unquote(parsed.path))
    base = _clean_path(base_url.path).rstrip("/")
    if cleaned == base:
        return None  # the base itself, not an object
    # The organizer's own directory (or the base) is a prefix, not an
    # object — never hand back a "directory key" for deletion.
    if cleaned == base + "/organizers/" + organizer_id:
        return None
    key = cleaned[len(base) + 1 :] if cleaned.startswith(base + "/") else cleaned.lstrip("/")
    return key


# Test seam: lets the skip decisions of delete_replaced_media be pinned
# without a network call to R2.
_delete_object = delete_object


def delete_replaced_media(organizer_id: str, old_url: str, new_url: str) -> None:
    """Remove the previous image object from R2 after a row's photoUrl
    has been committed with a new value. Best-effort by design, mirroring
    the notification publisher (ADR-012): a storage failure must never
    fail an already-committed update, so errors are logged and
    swallowed. Skipped when the URL did not change, when the old value
    is empty (nothing to delete), when the old URL is not this
    organizer's media (never delete what you do not own — the old URL
    itself is not logged: it can point at foreign media), and when both
    URLs resolve to the same key: a query-string cache buster, a
    fragment or an encoded path is the same object and must not be
    deleted from under the row that now points at it."""
    if old_url == "" or old_url == new_url:
        return
    # Without the R2 env set, media_key_from_url can only answer false —
    # report the actual cause instead of logging "not-own-media".
    try:
        config()
    except Exception as err:
        logx.error(err, {"organizerId": organizer_id, "op": "delete-replaced-media"})
        return
    key = media_key_from_url(organizer_id, old_url)
    if key is None:
        logx.info("skipped media cleanup", {"organizerId": organizer_id, "reason": "not-own-media"})
        return
    if media_key_from_url(organizer_id, new_url) == key:
        return
    try:
        _delete_object(key)
    except Exception as err:
        logx.error(err, {"organizerId": organizer_id, "key": key, "op": "delete-replaced-media"})


# ── Upload targets ───────────────────────────────────────────────────────────


def _signed_target(key: str, content_type: str, size: int) -> gen.ImageUploadTarget:
    from pydantic import AnyUrl, TypeAdapter

    upload_url, expires_at = signed_upload_url(key, content_type, size)
    url_adapter: TypeAdapter[AnyUrl] = TypeAdapter(AnyUrl)
    return gen.ImageUploadTarget(
        uploadUrl=url_adapter.validate_python(upload_url),
        publicUrl=url_adapter.validate_python(public_url(key)),
        expiresAt=iso_date(expires_at),
    )


def create_avatar_upload(
    organizer_id: str, payload: gen.CreateAvatarUploadInput
) -> gen.ImageUploadTarget:
    """A signed upload URL for an organizer's avatar (browser
    resizes/re-encodes first, then PUTs straight to R2)."""
    ext = ext_for_content_type(str(payload.contentType))
    key = avatar_key(organizer_id, ext)
    return _signed_target(key, str(payload.contentType), int(payload.size))


def create_service_photo_upload(
    organizer_id: str, payload: gen.CreateServicePhotoUploadInput
) -> gen.ImageUploadTarget:
    """A signed upload URL for a service cover photo (landscape covers
    get their own limits instead of reusing the avatar constants)."""
    ext = ext_for_content_type(str(payload.contentType))
    key = service_photo_key(organizer_id, ext)
    return _signed_target(key, str(payload.contentType), int(payload.size))
