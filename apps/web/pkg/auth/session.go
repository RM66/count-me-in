package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"countmein/pkg/contracts"
	"countmein/pkg/logx"
)

// Organizer session resolution.
//
// The Go API no longer decrypts the Auth.js session cookie. Instead,
// the Next.js edge middleware (proxy.ts) mints a short-lived HS256 JWT
// into the X-Organizer-Auth header for every /api/* request from a
// signed-in organizer. This is a stable, self-controlled format — not
// @auth/core's internal JWE wire format, which a minor Auth.js upgrade
// could change silently.
//
// The token: HS256, compact JWT, claims { sub, slug, iat, exp }, 60s
// TTL. **No separate secret**: the signing key is derived from the
// existing AUTH_SECRET via HKDF-SHA256 (RFC 5869) with a purpose-bound
// info string — the same key-separation pattern Auth.js itself uses.
// Deriving (rather than reusing the raw secret) keeps the two protocols
// independent; rotating AUTH_SECRET rotates both at once. The derivation
// parameters must match src/server/auth/organizer-token.ts exactly;
// parity is pinned by the golden vector in session_test.go.
//
// Verified with stdlib crypto only — no jose dependency.

// OrganizerAuthHeader is the HTTP header carrying the organizer-auth JWT.
const OrganizerAuthHeader = "X-Organizer-Auth"

// HKDF derivation parameters — must match organizer-token.ts exactly.
const (
	hkdfSalt = "countmein"
	hkdfInfo = "CountMeIn Organizer API Token Key v1"
	hkdfLen  = 32
)

var (
	warnMissingSecretOnce sync.Once
	warnBrokenTokenOnce   sync.Once
)

// Session is the organizer identity extracted from the organizer-auth
// token: Organizer.id IS the Auth.js user id (sub claim).
type Session struct {
	OrganizerID string
	Slug        string
}

// SessionFromRequest reads the organizer-auth header and verifies the
// JWT. Returns nil when there is no session (anonymous → demo cabinet
// visitor, ADR-010) or when the token cannot be verified.
func SessionFromRequest(r *http.Request) *Session {
	secret := os.Getenv("AUTH_SECRET")
	if secret == "" {
		warnMissingSecretOnce.Do(func() {
			logx.Info("AUTH_SECRET is not set — every request is anonymous", nil)
		})
		return nil
	}

	token := r.Header.Get(OrganizerAuthHeader)
	if token == "" {
		return nil
	}

	claims, err := verifyOrganizerAuth(token, secret)
	if err != nil {
		warnBrokenTokenOnce.Do(func() {
			logx.Info("organizer-auth token present but invalid (AUTH_SECRET mismatch or expiry)", nil)
		})
		return nil
	}
	return &Session{OrganizerID: claims.Sub, Slug: claims.Slug}
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

// ── HS256 JWT verification (stdlib only) ────────────────────────────────────

var (
	b64         = base64.RawURLEncoding
	errBadToken = errors.New("invalid organizer-auth token")
)

type organizerClaims struct {
	Sub  string `json:"sub"`
	Slug string `json:"slug"`
	Iat  int64  `json:"iat"`
	Exp  int64  `json:"exp"`
}

// verifyOrganizerAuth validates an HS256 compact JWT and returns its
// claims. The clock tolerance matches the old JWE decoder (15s).
func verifyOrganizerAuth(token, secret string) (*organizerClaims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, errBadToken
	}

	// Verify the signature before trusting any claim.
	mac := hmac.New(sha256.New, derivedSigningKey(secret))
	mac.Write([]byte(parts[0] + "." + parts[1]))
	expectedSig := b64.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(expectedSig), []byte(parts[2])) {
		return nil, errBadToken
	}

	// Decode the header and confirm the algorithm.
	headerJSON, err := b64.DecodeString(parts[0])
	if err != nil {
		return nil, errBadToken
	}
	var header struct {
		Alg string `json:"alg"`
		Typ string `json:"typ"`
	}
	if err := json.Unmarshal(headerJSON, &header); err != nil {
		return nil, errBadToken
	}
	if header.Alg != "HS256" {
		return nil, errBadToken
	}

	// Decode the claims.
	claimsJSON, err := b64.DecodeString(parts[1])
	if err != nil {
		return nil, errBadToken
	}
	var claims organizerClaims
	if err := json.Unmarshal(claimsJSON, &claims); err != nil {
		return nil, errBadToken
	}
	if claims.Sub == "" {
		return nil, errBadToken
	}

	// Expiry (15s clock tolerance, matching the old decoder). exp is
	// required: a token without it used to
	// be treated as non-expiring, but the mint always sets it — an
	// absent exp means a forged or malformed token, not a legacy one.
	if claims.Exp == 0 || time.Now().Add(-15*time.Second).Unix() > claims.Exp {
		return nil, errBadToken
	}
	return &claims, nil
}

// derivedSigningKey derives the HMAC-SHA256 signing key from AUTH_SECRET
// via HKDF-SHA256 (RFC 5869), extract-then-expand. Mirrors Node's
// crypto.hkdfSync('sha256', secret, salt, info, 32) — parity pinned by
// the golden vector in session_test.go.
func derivedSigningKey(secret string) []byte {
	// Extract: PRK = HMAC-SHA256(salt, IKM).
	h := hmac.New(sha256.New, []byte(hkdfSalt))
	h.Write([]byte(secret))
	prk := h.Sum(nil)

	// Expand: T(1) = HMAC-SHA256(PRK, info || 0x01); 32 bytes = one block.
	h = hmac.New(sha256.New, prk)
	h.Write([]byte(hkdfInfo))
	h.Write([]byte{1})
	return h.Sum(nil)[:hkdfLen]
}
