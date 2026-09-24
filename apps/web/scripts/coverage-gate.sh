#!/bin/sh
# Go coverage gate.
#
# Runs the full test suite with a coverage profile, then checks per-package
# statement coverage EXCLUDING generated code:
#   - pkg/api/gen/            (oapi-codegen output)
#   - pkg/contracts/constants_gen.go
#   - pkg/i18n/translations_gen.go
#
# Gate: the packages that carry the product's write-path invariants must stay
# above their floors; everything else is reported but ungated. A package with
# no non-generated statements is skipped (e.g. pkg/api/gen).
#
# Requires POSTGRES_URL/REDIS_URL for the integration tests to run (the same
# env the plain `go test` needs); without them coverage drops and the gate
# fails — run it against the docker-compose services.

set -eu

cd "$(dirname "$0")/.."

PROFILE="$(mktemp -t coverprofile.XXXXXX)"
trap 'rm -f "$PROFILE"' EXIT

echo "go test ./pkg/... (coverage profile)"
go test ./pkg/... -coverprofile="$PROFILE" >/dev/null

# Aggregate per-package statement coverage, generated files filtered out.
# `go tool cover -func` prints one line per function:
#   path/file.go:NN.NN: Name  0.0%
# Package coverage = covered statements / total statements, computed from the
# function table by summing only the files we own.
python3 - "$PROFILE" <<'PY'
import re
import sys
from collections import defaultdict

profile = sys.argv[1]
# mode: set + count of covered/total statements per file
covered = defaultdict(int)
total = defaultdict(int)

with open(profile) as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith("mode:"):
            continue
        # path/file.go:L.L,L.L numStmts count
        m = re.match(r"(.+?\.go):\d+\.\d+,\d+\.\d+ (\d+) (\d+)$", line)
        if not m:
            continue
        path, stmts, count = m.group(1), int(m.group(2)), int(m.group(3))
        total[path] += stmts
        if count > 0:
            covered[path] += stmts

GENERATED = ("/gen/", "constants_gen.go", "translations_gen.go")
pkg_cov = defaultdict(lambda: [0, 0])
for path, stmts in total.items():
    if any(marker in path for marker in GENERATED):
        continue
    # Paths are module-prefixed (countmein/pkg/...); key by the pkg/... suffix.
    idx = path.find("pkg/")
    pkg = path[idx:] if idx >= 0 else path
    pkg = pkg.rsplit("/", 1)[0] if "/" in pkg else "."
    pkg_cov[pkg][0] += covered[path]
    pkg_cov[pkg][1] += stmts

GATE = {
    # Coverage floors — the write-path invariant carriers. db/routes sit at
    # their read-layer remainder (their writes are pinned by
    # booking_writes_test); jobs/httpx/demo/auth/queue/storage carry the
    # dispatch, guard, notification and credential semantics.
    "pkg/db": 30.0,
    "pkg/routes": 20.0,
    "pkg/jobs": 80.0,
    "pkg/httpx": 60.0,
    "pkg/demo": 60.0,
    "pkg/auth": 85.0,
    "pkg/queue": 90.0,
    "pkg/storage": 50.0,
}

failed = False
print(f"{'package':<28} {'statements':>12}   gate")
for pkg in sorted(pkg_cov):
    cov, stmts = pkg_cov[pkg]
    pct = 100.0 * cov / stmts if stmts else 0.0
    floor = GATE.get(pkg)
    marker = ""
    if floor is not None:
        if pct + 1e-9 < floor:
            marker = f"  FAIL (floor {floor:.0f}%)"
            failed = True
        else:
            marker = f"  ok (floor {floor:.0f}%)"
    print(f"{pkg:<28} {pct:>11.1f}%{marker}")

if failed:
    sys.exit(1)
PY
