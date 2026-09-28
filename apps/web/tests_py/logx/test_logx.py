"""logx — the observability floor.

One JSON object per line on stdout, field names: time, level, msg +
extras. These tests pin the wire
format of the log lines: Vercel log drains parse them as JSON, so a
drift in the shape is a production incident, not a style issue.
"""

from __future__ import annotations

import json
import logging

import pytest
from countmein import logx


class _Capture(logging.Handler):
    """Collect formatted lines instead of writing them to stdout."""

    def __init__(self) -> None:
        super().__init__()
        self.lines: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.lines.append(self.format(record))


@pytest.fixture()
def capture():
    handler = _Capture()
    handler.setFormatter(logx._JsonFormatter())
    logger = logging.getLogger("countmein")
    logger.addHandler(handler)
    try:
        yield handler
    finally:
        logger.removeHandler(handler)


def parse(line: str) -> dict:
    return json.loads(line)


def test_info_emits_one_json_line(capture):
    logx.info("booking created", {"traceId": "t-1", "bookingId": "b-1"})
    assert len(capture.lines) == 1, "one line per record"
    rec = parse(capture.lines[0])
    assert rec["msg"] == "booking created"
    assert rec["level"] == "INFO"
    assert rec["traceId"] == "t-1"
    assert rec["bookingId"] == "b-1"


def test_line_carries_time_and_level_keys(capture):
    """Every line always carries time and level — the drain
    queries group by them, so both keys must exist on every line. The
    level names are uppercase (INFO/WARN/ERROR — never "WARNING")."""
    logx.info("x")
    logx.warn("y")
    logx.error(RuntimeError("z"))
    assert len(capture.lines) == 3
    for line in capture.lines:
        rec = parse(line)
        assert "time" in rec
        assert "level" in rec
        assert "msg" in rec
    assert [parse(line)["level"] for line in capture.lines] == ["INFO", "WARN", "ERROR"]


def test_error_none_is_dropped(capture):
    """Callers pass optional errors straight through — None must not
    produce a line."""
    logx.error(None)
    assert capture.lines == []


def test_error_message_is_the_exception_text(capture):
    logx.error(RuntimeError("qstash publish failed"), {"queue": "booking.created"})
    rec = parse(capture.lines[0])
    assert rec["msg"] == "qstash publish failed"
    assert rec["level"] == "ERROR"
    assert rec["queue"] == "booking.created"


def test_no_fields_still_emits_base_keys(capture):
    logx.info("lifecycle")
    rec = parse(capture.lines[0])
    assert rec == {"time": rec["time"], "level": "INFO", "msg": "lifecycle"}


def test_non_ascii_is_not_escaped(capture):
    """ensure_ascii=False: Cyrillic copy (notification templates, guest
    names) must stay readable in the drain, not \\u-escaped."""
    logx.info("гость забронировал место", {"name": "Анна"})
    assert "Анна" in capture.lines[0]


def test_warn_every_throttles_by_message(capture, monkeypatch):
    """A persistent fault stays visible without flooding: first call
    logs, an immediate repeat does not, a later one does."""
    # Reset the throttle map so test order cannot leak state.
    monkeypatch.setattr(logx, "_warn_every_last", {})
    logx.warn_every(3600.0, "QSTASH_TOKEN is not set", None)
    logx.warn_every(3600.0, "QSTASH_TOKEN is not set", None)
    logx.warn_every(3600.0, "QSTASH_TOKEN is not set", None)
    assert len(capture.lines) == 1, "repeats within the interval are suppressed"
    # A different message has its own throttle slot.
    logx.warn_every(3600.0, "REDIS_URL is not set", None)
    assert len(capture.lines) == 2


def test_warn_every_interval_expires(capture, monkeypatch):
    monkeypatch.setattr(logx, "_warn_every_last", {})
    logx.warn_every(0.0, "heartbeat", None)
    logx.warn_every(0.0, "heartbeat", None)
    assert len(capture.lines) == 2, "a zero interval never suppresses"


def test_new_trace_id_shape():
    """8 random bytes as hex (16 chars) — the id travels in QStash
    headers, so the length is part of the wire shape."""
    ids = {logx.new_trace_id() for _ in range(32)}
    assert len(ids) == 32, "trace ids must not collide"
    for tid in ids:
        assert len(tid) == 16
        int(tid, 16)  # hex
