"""Run the shared validation
vectors in packages/contracts/vectors/validation (the same corpus vitest
runs on the TS side). Keys are pinned, never message text."""

import json
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from _lib.countmein.contracts import domain
from _lib.countmein.errors import ValidationFailed
from _lib.countmein.validation.decode import DECODERS

VECTORS_DIR = (
    Path(__file__).resolve().parents[4] / "packages" / "contracts" / "vectors" / "validation"
)

_NOW_MARKER = re.compile(r"^\$now([+-]\d+)(s|m|h|d)$")


def _replace_now_markers(v):
    if isinstance(v, str):
        m = _NOW_MARKER.match(v)
        if m is None:
            return v
        amount = int(m.group(1))
        unit = m.group(2)
        d = {"s": 1, "m": 60, "h": 3600, "d": 86400}[unit]
        return domain.iso_date(datetime.now(UTC) + timedelta(seconds=amount * d))
    if isinstance(v, list):
        return [_replace_now_markers(item) for item in v]
    if isinstance(v, dict):
        return {k: _replace_now_markers(item) for k, item in v.items()}
    return v


def _load():
    assert VECTORS_DIR.is_dir(), f"vectors dir missing: {VECTORS_DIR}"
    for path in sorted(VECTORS_DIR.glob("*.json")):
        data = json.loads(path.read_text())
        for case in data["cases"]:
            yield pytest.param(data["schema"], case, id=f"{path.stem}/{case.get('name', '')}")


@pytest.mark.parametrize(("schema", "c"), list(_load()))
def test_validation_vectors(schema, c):
    parse = DECODERS.get(schema)
    assert parse is not None, f"no decoder dispatch for schema {schema}"
    body = json.dumps(_replace_now_markers(c["body"])).encode()
    try:
        parse(body)
        errs = None
    except ValidationFailed as exc:
        errs = exc.errors
    valid = errs is None
    if c.get("valid") is not None:
        assert valid == c["valid"], f"{c.get('name')}: valid={valid}, want {c['valid']} ({errs})"
    if c.get("fieldErrors") is not None:
        keys = sorted(errs.fields.keys()) if errs is not None else []
        assert keys == sorted(c["fieldErrors"]), (
            f"{c.get('name')}: fieldErrors={keys}, want {sorted(c['fieldErrors'])}"
        )
    if c.get("formErrors") is not None:
        got = len(errs.form) if errs is not None else 0
        assert got == c["formErrors"], f"{c.get('name')}: formErrors={got}, want {c['formErrors']}"


def test_reserved_slugs():
    from _lib.countmein.validation.rules import is_reserved_slug

    for slug in ("api", "booking", "cabinet", "signup", "login", "terms", "privacy", "demo"):
        assert is_reserved_slug(slug)
        assert is_reserved_slug(slug.upper())
    assert not is_reserved_slug("yoga-with-ada")


def test_timezone_rule():
    from _lib.countmein.validation.rules import timezone_rule

    assert timezone_rule("Europe/Belgrade") == ""
    assert timezone_rule("europe/belgrade") == ""  # case-insensitive re-cased lookup
    assert timezone_rule("America/New_York") == ""
    assert timezone_rule("local") != ""
    assert timezone_rule("") != ""
    assert timezone_rule("Not/AZone") != ""


def test_url_rule():
    from _lib.countmein.validation.rules import url_rule

    assert url_rule("https://example.com/x.png") == ""
    assert url_rule("http://example.com") == ""
    assert url_rule("javascript:alert(1)") != ""
    assert url_rule("ftp://example.com") != ""
    assert url_rule("/relative/path") != ""


def test_js_trim_set():
    from _lib.countmein.validation.errors import js_trim

    assert js_trim("  x  ") == "x"
    assert js_trim("\u00a0x\u00a0") == "x"  # U+00A0 is in the JS set
    assert js_trim("\ufeffx") == "x"  # BOM
    assert js_trim("\u2003x") == "x"  # em space (U+2000..U+200A range)
    assert js_trim("x\u0085") == "x\u0085"  # U+0085 is NOT in the JS set
