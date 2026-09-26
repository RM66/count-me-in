"""Keep docs/migration/vercel.target.json in sync with apps/web/vercel.json.

The target file is only applied at the Phase 6 cutover, so nothing else
would notice a new /api/... prefix added in Phases 3-5 drifting the two
apart. This test pins: identical rewrite sources, every destination is
/api/index?_path=<source>, and the function config keys are valid for the
Python runtime.
"""

import json
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
REPO = WEB.parents[1]
CURRENT = json.loads((WEB / "vercel.json").read_text())
TARGET = json.loads((REPO / "docs/migration/vercel.target.json").read_text())


def test_rewrite_sources_match_current_vercel_json() -> None:
    assert [r["source"] for r in TARGET["rewrites"]] == [r["source"] for r in CURRENT["rewrites"]]


def test_destinations_point_at_python_entry_with_path() -> None:
    for rewrite in TARGET["rewrites"]:
        assert rewrite["destination"] == f"/api/index?_path={rewrite['source']}", (
            f"bad destination for {rewrite['source']}"
        )


def test_python_function_config() -> None:
    functions = TARGET["functions"]
    assert list(functions) == ["api/index.py"]
    config = functions["api/index.py"]
    # The Go config's memory: 1024 is dropped — the key is ignored under fluid
    # compute, and omitting it avoids any Hobby-tier deploy rejection risk.
    # maxDuration 10 matches the Go budget.
    assert "memory" not in config
    assert config["maxDuration"] == 10
    assert config["includeFiles"] == "api/_lib/**"
    assert "excludeFiles" in config
