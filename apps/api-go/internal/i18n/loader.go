// Package i18n loads the app's translations (verbatim copies of
// packages/translations, embedded at build time) and renders them
// with an ICU subset.
//
// The duplication is forced: //go:embed patterns are resolved relative
// to this package and may not contain "..", and apps/api-go deploys
// as its own Vercel project — packages/translations is not even part
// of the deployed bundle, so neither embedding nor reading it at
// startup is possible. scripts/sync-translations.sh refreshes the
// copies; scripts/check-translations.sh (wired into scripts/build.sh)
// fails the build when they drift from the source.
package i18n

import (
	"embed" //nolint
	"encoding/json"
	"sync"

	"api-go/internal/contracts"
)

//go:embed translations/messages/*.json translations/notifications/*.json
var files embed.FS

// notifDict — notification copy is two shapes: top-level messages
// ("seats") and per-audience sections ("createdOrganizer" → title…).
type notifDict struct {
	top      map[string]string
	sections map[string]map[string]string
}

var (
	once sync.Once

	// locale → key → message (the ApiErrors section of the web messages).
	apiErrors = map[string]map[string]string{}
	// locale → notification copy.
	notifications = map[string]notifDict{}
)

func load() {
	once.Do(func() {
		for _, locale := range contracts.Locales {
			apiErrors[locale] = loadAPIErrors(locale)
			notifications[locale] = loadNotifications(locale)
		}
	})
}

func readJSON(path string) map[string]any {
	data, err := files.ReadFile(path)
	if err != nil {
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		return nil
	}
	return m
}

func loadAPIErrors(locale string) map[string]string {
	m := readJSON("translations/messages/" + locale + ".json")
	section, _ := m["ApiErrors"].(map[string]any)
	out := map[string]string{}
	for key, v := range section {
		if s, ok := v.(string); ok {
			out[key] = s
		}
	}
	return out
}

func loadNotifications(locale string) notifDict {
	m := readJSON("translations/notifications/" + locale + ".json")
	d := notifDict{top: map[string]string{}, sections: map[string]map[string]string{}}
	for section, v := range m {
		if s, ok := v.(string); ok {
			d.top[section] = s
			continue
		}
		entries, ok := v.(map[string]any)
		if !ok {
			continue
		}
		flat := map[string]string{}
		for key, s := range entries {
			if str, ok := s.(string); ok {
				flat[key] = str
			}
		}
		d.sections[section] = flat
	}
	return d
}

// apiError renders a localized API error (the ApiErrors section),
// falling back to English, then to the key itself.
func ApiError(locale, key string, params map[string]any) string {
	load()
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
	load()
	lookup := func(locale string) (string, bool) {
		d := notifications[locale]
		if section == "" {
			msg, ok := d.top[key]
			return msg, ok
		}
		msg, ok := d.sections[section][key]
		return msg, ok
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
