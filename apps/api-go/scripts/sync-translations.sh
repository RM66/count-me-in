#!/bin/sh
# Refresh the embedded translation copies from the monorepo source.
# The Go module cannot //go:embed files outside apps/api-go, so
# internal/i18n/translations holds verbatim copies of
# packages/translations/{messages,notifications}/*.json. Run after
# editing translations.
set -eu
cd "$(dirname "$0")/.."
mkdir -p internal/i18n/translations/messages internal/i18n/translations/notifications
cp ../../packages/translations/messages/*.json internal/i18n/translations/messages/
cp ../../packages/translations/notifications/*.json internal/i18n/translations/notifications/
echo "translations synced"
