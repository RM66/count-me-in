"""Shared helpers for the Phase 6 verification scripts (smoke, replay).

The golden transcripts normalize volatile values to numbered placeholders
by first appearance — the same scheme tests_py/parity/test_replay.py
uses. Both remote scripts need the identical substitution, so it lives
here once instead of drifting between two copies.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
WEB = HERE.parents[1]  # apps/web
GOLDEN = WEB / "tests_py" / "parity" / "golden"

UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE)
ISO_TS_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})")

# Headers the golden transcripts exclude (set by the recorder): they are
# hop/transport facts, not API behavior. The recorder excluded every
# `x-vercel-*` header, so the check matches on prefix, not an exact list.
EXCLUDED_HEADER_NAMES = {"date", "server", "content-length"}
EXCLUDED_HEADER_PREFIXES = ("x-vercel-",)


def is_excluded_header(name: str) -> bool:
    return name.lower() in EXCLUDED_HEADER_NAMES or name.lower().startswith(
        EXCLUDED_HEADER_PREFIXES
    )


def normalize(text: str) -> str:
    """uuid/ts -> numbered placeholders by first appearance; tokens by key
    name and 21-char service ids by key position (never by shape — free
    text must not be mangled). Mirrors test_replay.py's Normalizer.raw."""
    seen: dict[str, str] = {}
    uuid_n = 0
    ts_n = 0

    def ts_sub(m: re.Match[str]) -> str:
        nonlocal ts_n
        v = m.group(0)
        if v not in seen:
            ts_n += 1
            seen[v] = f"<ts:{ts_n}>"
        return seen[v]

    def uuid_sub(m: re.Match[str]) -> str:
        nonlocal uuid_n
        v = m.group(0).lower()
        if v not in seen:
            uuid_n += 1
            seen[v] = f"<uuid:{uuid_n}>"
        return seen[v]

    text = UUID_RE.sub(uuid_sub, text)
    text = ISO_TS_RE.sub(ts_sub, text)

    sid_seen: dict[str, str] = {}

    def sid_sub(m: re.Match[str]) -> str:
        v = m.group(3)
        if v not in sid_seen:
            sid_seen[v] = f"<sid:{len(sid_seen) + 1}>"
        return f'{m.group(1)}:"{sid_seen[v]}"'

    text = re.sub(r'("(?:ticket|manageToken|guestToken)"):("[^"]{20,}")', r'\1:"<token>"', text)
    text = re.sub(r'("(?:serviceId|id)"):("([A-Za-z0-9_-]{21})")', sid_sub, text)
    return text


def golden_steps(scenario: str) -> list[dict]:
    """The golden transcript's steps (request steps only — the recorder
    wrote one entry per request, with `repeat` expanded)."""
    return json.loads((GOLDEN / f"{scenario}.json").read_text())["steps"]


def golden_response(scenario: str, *, step: int | None = None, note: str | None = None) -> dict:
    """A golden step's response, addressed by index or by note substring
    (the note is the stable handle — indices shift when scenarios gain
    steps)."""
    steps = golden_steps(scenario)
    if note is not None:
        for s in steps:
            if note in s.get("note", ""):
                return s["response"]
        raise KeyError(f"no golden step in {scenario!r} matches note {note!r}")
    if step is None:
        raise ValueError("golden_response: step or note is required")
    return steps[step]["response"]
