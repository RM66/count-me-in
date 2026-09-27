"""vercel.json rewrite coverage (port of the retired router's config test).

The route set is pinned by the OpenAPI spec and the app restores the
original path from `?_path` — what no other check can see is whether
vercel.json actually rewrites every API path to the function entry. A
missing rewrite is a 404 in production behind Next.js with a green
build.

The check is deliberately pattern-based, not an exact match: vercel.json
uses /api/organizers/:path* rewrites for whole subtrees, so a new
/api/organizers/... path needs no edit while a new top-level /api/...
prefix does.

The entry destination is derived from the single `functions` key
(api/index.py → /api/index): the destination must be the function's
route path with the original path carried as ?_path.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]

# Matches a top-level key of the OpenAPI `paths` map at the two-space
# indent the generator emits (e.g. `  /api/services/{id}:`).
SPEC_PATH_LINE = re.compile(r"(?m)^  (/api/[^:\n]+):$")


def spec_paths() -> set[str]:
    data = (WEB / "openapi.yaml").read_text()
    paths = set(SPEC_PATH_LINE.findall(data))
    assert paths, "no /api paths found in the spec"
    assert "/api/jobs/{queue}" in paths, f"spec path extraction looks wrong — {sorted(paths)}"
    return paths


def vercel_rewrites() -> list[tuple[str, str]]:
    cfg = json.loads((WEB / "vercel.json").read_text())
    rewrites = cfg.get("rewrites", [])
    assert rewrites, "vercel.json declares no rewrites"

    functions = cfg.get("functions", {})
    assert len(functions) == 1, f"expected exactly one function, got {list(functions)}"
    key = next(iter(functions))
    # api/index.py → /api/index.
    entry = "/" + key[: -len(".py")] if key.endswith(".py") else "/" + key

    sources: list[tuple[str, str]] = []
    for rw in rewrites:
        assert rw["destination"] == f"{entry}?_path={rw['source']}", (
            f"rewrite {rw['source']} must carry the original path as ?_path "
            f"(got {rw['destination']!r})"
        )
        sources.append((rw["source"], rw["destination"]))
    return sources


def rewrite_regex(source: str) -> re.Pattern[str]:
    """Convert a vercel.json source pattern into a regexp with Vercel's
    semantics: ":path*" matches zero or more segments (so
    /api/services/:path* also covers the bare /api/services), ":name"
    matches exactly one."""
    parts = ["^"]
    for seg in source.split("/"):
        if not seg:
            continue
        if seg.startswith(":"):
            name = seg.removeprefix(":")
            parts.append("(?:/")
            parts.append(".+" if name.endswith("*") else "[^/]+")
            parts.append(")")
            if name.endswith("*"):
                parts.append("?")
        else:
            parts.append("/")
            parts.append(re.escape(seg))
    parts.append("$")
    return re.compile("".join(parts))


def test_vercel_rewrites_cover_spec_paths():
    rewrites = vercel_rewrites()
    for path in spec_paths():
        assert any(rewrite_regex(source).fullmatch(path) for source, _ in rewrites), (
            f"spec path {path} has no vercel.json rewrite — production would 404; add one"
        )


def test_healthz_rewrite():
    """/api/healthz is mounted outside the spec (infrastructure, not part
    of the OpenAPI surface), so the coverage test cannot see it — pin its
    rewrite explicitly (without it the probe 404s in production behind
    Next.js)."""
    assert any(source == "/api/healthz" for source, _ in vercel_rewrites()), (
        "vercel.json has no /api/healthz rewrite — the probe would 404 in production"
    )
