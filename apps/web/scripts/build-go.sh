#!/bin/sh
# Verify the module compiles the way Vercel will build it: pkg packages as
# a whole, the single Vercel entry (api/entry/index.go) as one function,
# and cmd/dev for local use. Also fails when formatting drifts.
# Translation copy is generated from packages/translations by
# scripts/generate-i18n-go.ts; CI verifies the generated file is current
# with `git diff --exit-code`.
#
# The package tree is pkg/ (not internal/) because Vercel's Go runtime
# compiles api/ handlers under a handler/ module prefix, and Go's
# internal-package visibility rule would block handler/api/... from
# importing countmein/internal/... — a non-internal name has no such
# restriction.
set -eu
cd "$(dirname "$0")/.."

go build ./pkg/... ./cmd/...
go vet ./pkg/... ./cmd/...
# -race: the pipeline is concurrent (inline outbox publish, sweeper) and
# the race detector is the only thing that sees interleaving bugs.
# ./api/... covers the entry point's ?_path restore.
go test -race ./pkg/... ./api/...

# Build the single Vercel entry point. -o /dev/null: the entry is a
# non-main package; without it the tool would try to write a binary next
# to the source.
if ! go build -o /dev/null ./api/entry/index.go; then
  echo "FAIL build ./api/entry/index.go" >&2
  exit 1
fi
if ! go vet ./api/entry/index.go >/dev/null 2>&1; then
  echo "FAIL vet ./api/entry/index.go" >&2
  exit 1
fi

unformatted=$(gofmt -l .)
if [ -n "$unformatted" ]; then
  echo "gofmt needed: $unformatted" >&2
  exit 1
fi

echo "api entry file compiles, gofmt clean"
