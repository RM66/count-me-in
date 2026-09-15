#!/bin/sh
# Verify the module compiles the way Vercel will build it: internal
# packages as a whole, api/ entry files one at a time (each .go file
# becomes its own serverless function compiled individually). Dynamic
# route dirs use plain names (by-id, by-queue) — vercel.json rewrites
# map :id / :queue to them. Also fails when formatting drifts.
# Translation copy is generated from packages/translations by
# scripts/generate-i18n-go.ts; CI verifies the generated file is
# current with `git diff --exit-code`.
set -eu
cd "$(dirname "$0")/.."

go build ./internal/... ./cmd/...
go vet ./internal/... ./cmd/...
go test ./internal/...

status=0
for f in $(find api -name '*.go' | sort); do
  # -o /dev/null: entry files are non-main packages; without it the
  # tool would try to write a binary next to the source.
  if ! go build -o /dev/null "$f"; then
    echo "FAIL build $f" >&2
    status=1
  fi
  if ! go vet "$f" >/dev/null 2>&1; then
    echo "FAIL vet $f" >&2
    status=1
  fi
done

unformatted=$(gofmt -l .)
if [ -n "$unformatted" ]; then
  echo "gofmt needed: $unformatted" >&2
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "all api entry files compile, gofmt clean"
fi
exit "$status"
