package auth

import (
	"net/http"
	"os"
	"sync"

	"api-go/internal/contracts"
	"api-go/internal/logx"
)

// Auth.js session cookie names, https ("__Secure-"-prefixed, prod) first.
// Deliberate deviation: Auth.js itself reads only the __Secure- name
// over HTTPS, but both are tried here — a token minted for one cookie
// cannot decrypt under the other (the HKDF key is bound to the cookie
// name), so accepting both is safe and eases local http development.
var sessionCookieNames = [2]string{"__Secure-authjs.session-token", "authjs.session-token"}

var (
	warnMissingSecretOnce sync.Once
	warnBrokenTokenOnce   sync.Once
)

// Session is the organizer identity extracted from the Auth.js session
// token: Organizer.id IS the Auth.js user id (sub claim).
type Session struct {
	OrganizerID string
	Slug        string
}

// SessionFromRequest reads the session token cookie and decrypts it.
// Returns nil when there is no session (anonymous → demo cabinet
// visitor, ADR-010) or when the token cannot be decrypted.
func SessionFromRequest(r *http.Request) *Session {
	secret := os.Getenv("AUTH_SECRET")
	if secret == "" {
		// Next.js would throw; here every request is anonymous.
		warnMissingSecretOnce.Do(func() {
			logx.Info("AUTH_SECRET is not set — every request is anonymous", nil)
		})
		return nil
	}

	// Try both cookie names; warn only after the loop, when a token was
	// present but none of them decoded — warning per cookie would fire
	// spuriously when a client sends both and only one is valid.
	tokenPresent := false
	for _, cookieName := range sessionCookieNames {
		c, err := r.Cookie(cookieName)
		if err != nil || c.Value == "" {
			continue
		}
		tokenPresent = true
		claims, err := decodeSessionToken(c.Value, secret, cookieName)
		if err == nil {
			return &Session{OrganizerID: claims.Sub, Slug: claims.Slug}
		}
	}
	if tokenPresent {
		warnBrokenTokenOnce.Do(func() {
			logx.Info("session token present but undecryptable (AUTH_SECRET mismatch or Auth.js format change)", nil)
		})
	}
	return nil
}

// SessionOrganizerID is the organizer id behind the request, or ""
// when anonymous.
func SessionOrganizerID(r *http.Request) string {
	if s := SessionFromRequest(r); s != nil {
		return s.OrganizerID
	}
	return ""
}

// IsDemoOrganizerSession — convenience for callers that only need the
// demo check.
func IsDemoOrganizerSession(r *http.Request) bool {
	return contracts.IsDemoOrganizerID(SessionOrganizerID(r))
}
