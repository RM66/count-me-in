"""JSON-lines logging on stdout — the observability floor.

One JSON object per line, what Vercel log drains parse. Sentry/PostHog
are out of the dependency set — structured logging is the baseline.
Field names match the Go implementation: time, level, msg, plus extras.
"""

import json
import logging
import secrets
import sys
import threading
import time
from collections.abc import Mapping
from typing import Any, ClassVar

_LEVELS = {"info": logging.INFO, "warn": logging.WARNING, "error": logging.ERROR}


class _JsonFormatter(logging.Formatter):
    # Go's slog JSON handler emits uppercase level names (INFO/WARN/
    # ERROR — never "WARNING"); the drain's level filters match the
    # exact string, so the case is part of the wire format.
    _LEVEL_NAMES: ClassVar[dict[str, str]] = {"WARNING": "WARN"}

    def format(self, record: logging.LogRecord) -> str:
        level = self._LEVEL_NAMES.get(record.levelname, record.levelname)
        out: dict[str, Any] = {
            "time": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created))
            + f".{int(record.msecs):03d}Z",
            "level": level,
            "msg": record.getMessage(),
        }
        for key, value in record.__dict__.get("extra_fields", {}).items():
            out[key] = value
        return json.dumps(out, ensure_ascii=False, default=str)


_logger = logging.getLogger("countmein")
_logger.setLevel(logging.INFO)
_logger.propagate = False
if not _logger.handlers:  # pragma: no cover - import-time setup
    _handler = logging.StreamHandler(sys.stdout)
    _handler.setFormatter(_JsonFormatter())
    _logger.addHandler(_handler)


def _emit(level: str, msg: str, fields: Mapping[str, Any]) -> None:
    record = _logger.makeRecord("countmein", _LEVELS[level], "", 0, msg, (), None)
    record.__dict__["extra_fields"] = dict(fields)
    _logger.handle(record)


def info(msg: str, fields: Mapping[str, Any] | None = None) -> None:
    """Log a notable event: skips, refusals, lifecycle."""
    _emit("info", msg, fields or {})


def warn(msg: str, fields: Mapping[str, Any] | None = None) -> None:
    """Log a condition that degrades behavior but does not fail the request."""
    _emit("warn", msg, fields or {})


def error(err: BaseException | None, fields: Mapping[str, Any] | None = None) -> None:
    """Log a failure; None errors are dropped so callers can pass optional
    errors straight through."""
    if err is None:
        return
    _emit("error", str(err), fields or {})


_warn_every_lock = threading.Lock()
_warn_every_last: dict[str, float] = {}


def warn_every(interval: float, msg: str, fields: Mapping[str, Any] | None = None) -> None:
    """Log msg at most once per interval.

    Use for conditions that repeat on every request (missing secret,
    broken token) — the first occurrence and a periodic heartbeat, not a
    flood. A "once per process" rule would make a production
    misconfiguration nearly invisible on a warmed instance.
    """
    with _warn_every_lock:
        last = _warn_every_last.get(msg)
        now = time.monotonic()
        if last is not None and now - last < interval:
            return
        _warn_every_last[msg] = now
    warn(msg, fields)


def new_trace_id() -> str:
    """Short random hex id correlating a request across the async pipeline.

    The id travels in the QStash job payload and is emitted in every log
    line in both the API handler and the job handler, so debugging "I
    booked but didn't get a message" becomes a grep for one id.
    """
    return secrets.token_hex(8)
