"""Response-side contract validation (ADR-024 B3).

`assert_matches_spec` validates a real handler response against the
declared schema in the bundled OpenAPI document — via jsonschema over
`spec_gen.json`, the same authority Phase C uses on the request side.
A serializer that drifts off-contract becomes a red test, not a
shipped body (`model_construct` on the way out is deliberate, so only
this harness and the goldens would notice).

The route-suite `client` fixture wraps httpx.AsyncClient so every
response from a spec-declared operation is checked automatically;
tests may also call `assert_matches_spec` directly.
"""

from __future__ import annotations

import functools
from typing import Any

import httpx
from countmein.validation import spec as spec_mod


def _ptr(segment: str) -> str:
    """JSON Pointer escaping for one reference segment."""
    return segment.replace("~", "~0").replace("/", "~1")


def _match_template(path: str) -> str | None:
    """The spec path template matching this concrete request path —
    `{param}` covers exactly one non-empty segment; None when the route
    is outside the public contract (healthz, …)."""
    for tpl in spec_mod._load().get("paths", {}):
        t, p = tpl.split("/"), path.split("/")
        if len(t) == len(p) and all(
            ts == ps or (ts.startswith("{") and ts.endswith("}") and ps != "")
            for ts, ps in zip(t, p, strict=True)
        ):
            return tpl
    return None


def _response_ref(template: str, method: str, status: int) -> str | None:
    """A registry ref to the declared response schema, or None when the
    status is declared without a JSON body contract (e.g. 500, 204)."""
    op = spec_mod._load()["paths"][template].get(method)
    if op is None:
        raise AssertionError(f"{method.upper()} {template} is not declared in the spec")
    responses = op.get("responses", {})
    key = str(status) if str(status) in responses else "default"
    entry = responses.get(key)
    if entry is None:
        raise AssertionError(
            f"{method.upper()} {template} returned {status}, which is not declared in the spec"
        )
    if "schema" not in entry.get("content", {}).get("application/json", {}):
        return None
    return (
        f"{spec_mod._SPEC_URI}#/paths/{_ptr(template)}/{method}"
        f"/responses/{_ptr(key)}/content/application~1json/schema"
    )


@functools.cache
def _validator(ref: str) -> Any:
    import jsonschema

    return jsonschema.Draft202012Validator(
        {"$ref": ref},
        registry=spec_mod._registry(),
        format_checker=spec_mod._format_checker(),
    )


def assert_matches_spec(method: str, path: str, status: int, body: Any) -> None:
    """Validate a response body against the spec-declared schema for the
    operation and status. Fails on an undeclared status for a declared
    operation; skips routes and body-less statuses outside the contract."""
    template = _match_template(path)
    if template is None:
        return
    ref = _response_ref(template, method.lower(), status)
    if ref is None:
        return
    errors = sorted(_validator(ref).iter_errors(body), key=lambda e: list(e.absolute_path))
    if errors:
        details = "\n".join(
            f"  {'/'.join(str(p) for p in e.absolute_path) or '<root>'}: {e.message}"
            for e in errors[:10]
        )
        raise AssertionError(
            f"{method.upper()} {template} → {status} body does not match the "
            f"declared schema:\n{details}"
        )


def check_response(response: httpx.Response) -> None:
    """The client-fixture hook: validate a JSON response against the spec."""
    if "application/json" not in response.headers.get("content-type", ""):
        return
    body = response.json() if response.content else None
    assert_matches_spec(
        response.request.method, response.request.url.path, response.status_code, body
    )


class ContractClient(httpx.AsyncClient):
    """An AsyncClient that contract-checks every response it gets back —
    the B3 harness rolled over the whole route suite via the fixture."""

    async def request(self, method: str, url: Any, **kwargs: Any) -> httpx.Response:
        response = await super().request(method, url, **kwargs)
        check_response(response)
        return response
