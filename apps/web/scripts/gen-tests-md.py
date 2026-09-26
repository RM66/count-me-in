"""Regenerate docs/migration/tests.md: one row per Go `func Test`, with a
`cases: N` counter (the number of t.Run subtests the Go test defines, 1
when it has none). The pytest-name mapping is preserved from the current
tests.md where present; otherwise the name is derived by the naming rule.

Run from apps/web:  uv run python scripts/gen-tests-md.py
"""

from __future__ import annotations

import re
from collections import OrderedDict
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
DOCS = WEB.parent.parent / "docs" / "migration"
CURRENT = DOCS / "tests.md"

# Section headers in the current file: "## <go pkg/file hint> → <pytest module>".
# We map a Go test file path to its section by the package directory.
current = CURRENT.read_text()

# Existing TestName → pytest name mapping (from the current tables).
name_map: dict[str, str] = {}
for cell in re.findall(r"\|([^|\n]+)\|([^|\n]+)\|", current):
    go_cell, py_cell = cell[0].strip(), cell[1].strip()
    if not go_cell.startswith("Test"):
        continue
    go_names = [n.strip() for n in re.split(r",\s*", go_cell) if n.strip().startswith("Test")]
    py_names = [n.strip() for n in re.split(r",\s*", py_cell) if n.strip().startswith("test")]
    for g, p in zip(go_names, py_names, strict=False):
        # strip a "file.py: " prefix some old rows carried
        p = re.sub(r"^\S+\.py:\s*", "", p)
        name_map[g] = p


def snake(name: str) -> str:
    """TestFooAPIPath → test_foo_api_path (acronym runs stay together)."""
    s = name.removeprefix("Test")
    s = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", s)
    s = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", "_", s)
    s = re.sub(r"(?<=[A-Za-z])(?=\d)", "_", s)
    s = re.sub(r"(?<=\d)(?=[A-Za-z])", "_", s)
    return "test_" + s.lower()


def go_test_files() -> OrderedDict[str, list[tuple[str, int]]]:
    """file path (sorted) → [(TestName, subtest count)]."""
    out = [
        str(p.relative_to(WEB))
        for p in WEB.glob("pkg/**/*.go") + WEB.glob("api/**/*.go")
        if "func Test" in p.read_text()
    ]
    result: OrderedDict[str, list[tuple[str, int]]] = OrderedDict()
    for path in sorted(out):
        src = (WEB / path).read_text()
        tests: list[tuple[str, int]] = []
        # Split on top-level func declarations.
        for m in re.finditer(r"^func (Test[A-Za-z0-9_]+)\(t \*testing\.T\) \{", src, re.M):
            start = m.end()
            depth = 1
            i = start
            while depth and i < len(src):
                if src[i] == "{":
                    depth += 1
                elif src[i] == "}":
                    depth -= 1
                i += 1
            body = src[start:i]
            subtests = len(re.findall(r"\bt\.Run\(", body))
            tests.append((m.group(1), subtests if subtests else 1))
        if tests:
            result[path] = tests
    return result


files = go_test_files()


# Section title per Go package dir, from the current file's headers where
# available; the pytest module column is derived per file.
def section_for(path: str) -> tuple[str, str]:
    d = str(Path(path).parent)
    # find an existing header mentioning this dir
    for h in re.finditer(r"^## ([^\n]+)$", current, re.M):
        title = h.group(1)
        if d in title:
            return title, title
    return d, d


lines = [
    "# Test inventory (Phase 1.3): Go tests → ported pytest files",
    "",
    "One row per Go `func Test`, with a `cases: N` counter — the number of",
    "`t.Run` subtests the Go test defines (1 when it has none). Naming rule:",
    "`TestFooBar` → `test_foo_bar` (indicative — a Go test with several",
    "subtests may map to several focused pytest cases). Status updated during",
    "Phase 3: every row is `ported`.",
    "",
]

seen_sections: dict[str, list[str]] = {}
for path, tests in files.items():
    title, _ = section_for(path)
    seen_sections.setdefault(title, []).extend(
        f"| {name} | {name_map.get(name, snake(name))} | cases: {n} | ported |" for name, n in tests
    )

for title, rows in seen_sections.items():
    lines.append(f"## {title}")
    lines.append("")
    lines.append("| Go test | pytest name | Cases | Status |")
    lines.append("| --- | --- | --- | --- |")
    lines.extend(rows)
    lines.append("")

CURRENT.write_text("\n".join(lines) + "\n")
total = sum(len(r) for r in seen_sections.values())
print(f"wrote {CURRENT} — {total} rows across {len(seen_sections)} sections")
