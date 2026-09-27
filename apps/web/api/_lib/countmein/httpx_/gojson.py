"""JSON encoding byte-compatible with Go's encoding/json.

Go's json.Marshal: HTML-escapes < > & (as \\u003c \\u003e \\u0026),
emits compact separators, sorts map keys, renders struct fields in
declaration order (Pydantic model_dump preserves field order), and
appends no trailing newline (Marshal, not Encoder).
"""

import uuid as _uuid
from typing import Any

_ESCAPES = {
    '"': '\\"',
    "\\": "\\\\",
    "\n": "\\n",
    "\r": "\\r",
    "\t": "\\t",
    "\b": "\\b",
    "\f": "\\f",
    "<": "\\u003c",
    ">": "\\u003e",
    "&": "\\u0026",
    "\u2028": "\\u2028",
    "\u2029": "\\u2029",
}


def _encode_string(s: str, out: list[str]) -> None:
    out.append('"')
    for ch in s:
        esc = _ESCAPES.get(ch)
        if esc is not None:
            out.append(esc)
        elif ch < " ":
            out.append(f"\\u{ord(ch):04x}")
        else:
            out.append(ch)
    out.append('"')


def _encode_float(v: float, out: list[str]) -> None:
    # Go renders floats with the shortest representation that round-trips.
    if v != v or v in (float("inf"), float("-inf")):
        raise ValueError("unsupported float value")
    if v == int(v) and abs(v) < 1e21:
        out.append(str(int(v)))
    else:
        out.append(repr(v))


def _encode(value: Any, out: list[str]) -> None:
    if value is None:
        out.append("null")
    elif isinstance(value, bool):
        out.append("true" if value else "false")
    elif isinstance(value, str):
        _encode_string(value, out)
    elif isinstance(value, int):
        out.append(str(value))
    elif isinstance(value, float):
        _encode_float(value, out)
    elif isinstance(value, _uuid.UUID):
        # Go's uuid.UUID marshals as its canonical string form.
        _encode_string(str(value), out)
    elif isinstance(value, dict):
        out.append("{")
        first = True
        for key in sorted(value.keys()):
            if not first:
                out.append(",")
            first = False
            _encode_string(str(key), out)
            out.append(":")
            _encode(value[key], out)
        out.append("}")
    elif isinstance(value, (list, tuple)):
        out.append("[")
        for i, item in enumerate(value):
            if i:
                out.append(",")
            _encode(item, out)
        out.append("]")
    else:
        raise TypeError(f"cannot encode {type(value).__name__}")


def dumps_go(value: Any) -> str:
    """Marshal value the way Go's json.Marshal would."""
    out: list[str] = []
    _encode(value, out)
    return "".join(out)
