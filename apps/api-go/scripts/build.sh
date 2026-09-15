#!/bin/sh
# Verify the module compiles the way Vercel will build it: internal
# packages as a whole, api/ entry files one at a time (each .go file
# becomes its own serverless function compiled individually, and the
# bracket route dirs — [id], [queue] — cannot appear in a ./... pattern
# because the Go tool rejects '[' in import paths). Also fails when
# formatting drifts or the embedded translations drift from
# packages/translations.
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

sh scripts/check-translations.sh

if [ "$status" -eq 0 ]; then
  echo "all api entry files compile, gofmt clean, translations in sync"
fi
exit "$status"
