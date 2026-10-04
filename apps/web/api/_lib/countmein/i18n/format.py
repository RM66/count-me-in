"""ICU message rendering — the subset the app's translations use.

`{name}` placeholders and `{name, plural, =1 {…} one {…} other {…}}`
clauses (with `#` inside clauses standing for the number). `select` and
other ICU features are not implemented (absent from the corpus) and
render nothing.
"""

from collections.abc import Mapping
from typing import Any

from .plural import plural_category

_SPACES = " \t\n\r"


def _is_space(c: str) -> bool:
    return c in _SPACES


def _skip_space(msg: str, i: int) -> int:
    while i < len(msg) and _is_space(msg[i]):
        i += 1
    return i


def _read_balanced(msg: str, start: int) -> tuple[str, int]:
    depth = 0
    for i in range(start, len(msg)):
        c = msg[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return msg[start + 1 : i], i + 1
    return msg[start + 1 :], len(msg)


def _render_param(sb: list[str], name: str, params: Mapping[str, Any]) -> None:
    if name not in params:
        # A missing param renders as-is so it stays visible in logs.
        sb.append("{" + name + "}")
        return
    sb.append(str(params[name]))


def _param_number(name: str, params: Mapping[str, Any]) -> int | None:
    if name not in params:
        return None
    v = params[name]
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return int(v)
    return None


def format_message(msg: str, locale: str, params: Mapping[str, Any]) -> str:
    """Render an ICU message with params."""
    sb: list[str] = []
    _format_into(sb, msg, locale, params, None)
    return "".join(sb)


def _format_into(
    sb: list[str],
    msg: str,
    locale: str,
    params: Mapping[str, Any],
    plural_arg: int | None,
) -> None:
    i = 0
    n = len(msg)
    while i < n:
        c = msg[i]
        if c == "#" and plural_arg is not None:
            sb.append(str(plural_arg))
            i += 1
            continue
        if c != "{":
            sb.append(c)
            i += 1
            continue

        # Placeholder: read the argument name up to ',' or '}'.
        j = i + 1
        while j < n and msg[j] not in ",}":
            j += 1
        if j >= n:
            sb.append(msg[i:])
            return
        name = msg[i + 1 : j]
        if msg[j] == "}":
            _render_param(sb, name, params)
            i = j + 1
            continue

        # Complex argument: `{name, plural, <clauses>}`. Read the
        # keyword ("plural") up to the next comma.
        k = j + 1
        while k < n and msg[k] not in ",{}":
            k += 1
        keyword = msg[j + 1 : k].strip()
        if k >= n or msg[k] != ",":
            sb.append(msg[i:])
            return
        p = k + 1

        clauses: dict[str, str] = {}
        while p < n and msg[p] != "}":
            p = _skip_space(msg, p)
            s = p
            while p < n and msg[p] != "{" and not _is_space(msg[p]):
                p += 1
            selector = msg[s:p]
            p = _skip_space(msg, p)
            if p >= n or msg[p] != "{":
                break
            text, p = _read_balanced(msg, p)
            clauses[selector] = text
        if p < n:
            p += 1  # consume the argument's closing '}'

        if keyword == "plural":
            num = _param_number(name, params)
            chosen: str | None = None
            if num is not None:
                # Exact "=N" matches win over CLDR categories.
                chosen = clauses.get("=" + str(num))
                if chosen is None:
                    chosen = clauses.get(plural_category(locale, num))
            if chosen is None:
                chosen = clauses.get("other")
            if chosen is not None:
                _format_into(sb, chosen, locale, params, num)
        i = p
