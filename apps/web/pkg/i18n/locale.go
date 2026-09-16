package i18n

import (
	"net/http"

	"countmein/internal/contracts"
)

// DetectLocale resolves the viewer's locale the way next-intl does on
// the server (ADR-011): cookie NEXT_LOCALE → Accept-Language → default.
func DetectLocale(r *http.Request) string {
	if c, err := r.Cookie("NEXT_LOCALE"); err == nil && contracts.IsAppLocale(c.Value) {
		return c.Value
	}
	if locale, ok := contracts.MatchLocale(r.Header.Get("Accept-Language")); ok {
		return locale
	}
	return contracts.DefaultLocale
}
