#!/bin/sh
# Fail when the embedded translation copies have drifted from
# packages/translations (the source of truth). The Go module cannot
# //go:embed files outside apps/api-go, so internal/i18n/translations
# holds verbatim copies; this check keeps the duplication honest.
# Fix drift with: scripts/sync-translations.sh
set -eu
cd "$(dirname "$0")/.."

status=0

# Changed or missing copies.
for kind in messages notifications; do
  for src in ../../packages/translations/$kind/*.json; do
    [ -e "$src" ] || continue
    name=$(basename "$src")
    dst="internal/i18n/translations/$kind/$name"
    if [ ! -f "$dst" ]; then
      echo "missing embedded copy: $kind/$name" >&2
      status=1
    elif ! cmp -s "$src" "$dst"; then
      echo "drifted embedded copy: $kind/$name" >&2
      status=1
    fi
  done
done

# Stale copies whose source disappeared.
for kind in messages notifications; do
  for dst in internal/i18n/translations/$kind/*.json; do
    [ -e "$dst" ] || continue
    name=$(basename "$dst")
    if [ ! -f "../../packages/translations/$kind/$name" ]; then
      echo "stale embedded copy without source: $kind/$name" >&2
      status=1
    fi
  done
done

if [ "$status" -ne 0 ]; then
  echo "translation copies are out of sync — run 'bun run sync:go' (from packages/translations) or apps/api-go/scripts/sync-translations.sh" >&2
fi
exit "$status"
