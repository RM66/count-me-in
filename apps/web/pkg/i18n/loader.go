// Package i18n holds the app's translations (generated from
// packages/translations by scripts/generate-i18n-go.ts) and renders
// them with an ICU subset.
//
// The Go API only needs two slices of the full corpus: the ApiErrors
// section of the web messages (route error copy) and all notification
// copy (Telegram bot). translations_gen.go compiles those slices into
// native Go maps at build time — no //go:embed, no runtime JSON
// parsing, no duplicated files. packages/translations remains the
// single source of truth; CI verifies the generated file is current
// with `git diff --exit-code`.
package i18n

import (
	"countmein/pkg/contracts"
)

// notifDict — notification copy is two shapes: top-level messages
// ("seats") and per-audience sections ("createdOrganizer" → title…).
type notifDict struct {
	top      map[string]string
	sections map[string]map[string]string
}

var (
	// locale → key → message (the ApiErrors section of the web messages).
	// Populated by init() in translations_gen.go.
	apiErrors = map[string]map[string]string{}
	// locale → notification copy.
	// Populated by init() in translations_gen.go.
	notifications = map[string]notifDict{}
)

// ApiError renders a localized API error (the ApiErrors section),
// falling back to English, then to the key itself.
func ApiError(locale, key string, params map[string]any) string {
	msg, ok := apiErrors[locale][key]
	if !ok {
		msg, ok = apiErrors[contracts.DefaultLocale][key]
		if !ok {
			return key
		}
		locale = contracts.DefaultLocale
	}
	return Format(msg, locale, params)
}

// Notif renders a notification message. section "" addresses the
// top-level keys ("seats"); otherwise section.key. Falls back to
// English, then to "section.key".
func Notif(locale, section, key string, params map[string]any) string {
	lookup := func(loc string) (string, bool) {
		d, ok := notifications[loc]
		if !ok {
			return "", false
		}
		if section == "" {
			msg, found := d.top[key]
			return msg, found
		}
		msg, found := d.sections[section][key]
		return msg, found
	}
	msg, ok := lookup(locale)
	if !ok {
		msg, ok = lookup(contracts.DefaultLocale)
		if !ok {
			if section == "" {
				return key
			}
			return section + "." + key
		}
		locale = contracts.DefaultLocale
	}
	return Format(msg, locale, params)
}
