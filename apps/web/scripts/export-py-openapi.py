"""Export the Python app's route surface as an OpenAPI document.

Builds the spec from the FastAPI routes with openapi_url enabled in a
test-only factory (the production app never serves its own spec — the
public document is the Zod-rendered openapi.yaml). The handlers
deliberately bypass FastAPI's validation layer (the shared validation/
package owns request decoding), so the generated operations carry no
body/response metadata; each registered route is therefore dressed with
its canonical operation object (openapi_extra) before FastAPI renders
the document. The (method, path) set comes from the live registrations
— pinned independently against openapi.yaml by
tests_py/test_route_set.py — and the components section (the
Zod-rendered schemas shared by both stacks) is copied at document level,
where route-level extra cannot reach.

The output feeds the bidirectional `oasdiff breaking` check.

Usage: uv run python scripts/export-py-openapi.py [out]
Default out: openapi.py.yaml next to openapi.yaml.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import yaml

# The script runs from apps/web; the app lives under api/_lib on
# sys.path (imports resolve as `countmein.*`).
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api" / "_lib"))


def _canonical_operations() -> tuple[dict, dict]:
    """(operations, components) from the Zod-rendered spec: the
    operation object per (method, path), and the shared schema
    components."""
    spec = yaml.safe_load((ROOT / "openapi.yaml").read_text())
    operations: dict[tuple[str, str], dict] = {}
    for path, item in spec["paths"].items():
        for method, op in item.items():
            if method in {"get", "post", "put", "patch", "delete"} and isinstance(op, dict):
                operations[(method.upper(), path)] = op
    return operations, spec.get("components", {})


def export() -> str:
    from countmein.routes import register_routes
    from fastapi import FastAPI

    # Test-only factory: openapi_url enabled so FastAPI renders the
    # route surface; docs/redoc stay off (they add nothing to the
    # contract). The production create_app() keeps all three disabled.
    app = FastAPI(openapi_url="/openapi.json")
    register_routes(app)

    operations, components = _canonical_operations()

    # The route set comes from the live registrations (pinned against
    # openapi.yaml by tests_py/test_route_set.py); the operation
    # content is the canonical Zod-rendered one, because the handlers
    # deliberately bypass FastAPI's validation layer (the shared
    # validation/ package owns request decoding) and FastAPI's
    # generated operations would otherwise be skeletal — plus its own
    # 422/HTTPValidationError plumbing, which this app does not use.
    doc = app.openapi()
    paths: dict = doc.get("paths", {})
    for route in app.routes:
        methods = getattr(route, "methods", None)
        if not methods or route.path not in paths:
            continue
        for method in methods:
            if method == "HEAD":
                continue
            key = method.lower()
            if key not in paths[route.path] or not isinstance(paths[route.path][key], dict):
                continue
            op = operations.get((method, route.path))
            if op is not None:
                paths[route.path][key] = op
            else:
                # Not a spec operation (none today — healthz is
                # include_in_schema=False): drop FastAPI's skeletal
                # rendering entirely.
                paths[route.path].pop(key, None)
        if not paths[route.path]:
            paths.pop(route.path, None)
    # Route-level extra cannot carry document-level sections; the
    # components (Zod-rendered schemas + the sessionCookie security
    # scheme) are the shared contract both stacks render against.
    doc["components"] = components
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "openapi.py.yaml"
    out.write_text(export(), encoding="utf-8")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
