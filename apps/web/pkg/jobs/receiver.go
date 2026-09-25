package jobs

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"countmein/pkg/logx"
)

// QStash signature verification (port of @upstash/qstash@2.11.3's
// Receiver, which verifies via jose with the signing key as the HMAC
// secret). The upstash-signature header is a JWT:
//
//   - HS256 over "header.payload", the secret being the raw UTF-8
//     bytes of the current or next signing key. The algorithm is
//     pinned: this account's QStash signs HS256, and accepting
//     HS384/HS512 with the same secret only widens the surface —
//     a forged header must not be able to pick its own algorithm;
//   - issuer claim "Upstash";
//   - exp claim checked with a 60s clock tolerance (function clocks may
//     lag seconds behind the signer; skew use is logged throttled);
//   - body claim = base64url(SHA-256(request body)); trailing "="
//     padding stripped on both sides before comparing.
//
// Try currentSigningKey first, then nextSigningKey (key rotation).
// The signature comparison is over the raw decoded bytes, not the
// base64 strings — comparing encoded strings leaks length before
// content.

type qstashHeader struct {
	Alg string `json:"alg"`
	Typ string `json:"typ"`
}

type qstashClaims struct {
	Iss  string `json:"iss"`
	Sub  string `json:"sub"`
	Exp  int64  `json:"exp"`
	Nbf  int64  `json:"nbf"`
	Body string `json:"body"`
}

// qstashExpSkew — clock tolerance on the exp claim: QStash mints exp at
// sign time and the function clock may lag seconds behind. A token past
// exp but within the skew still verifies (with a throttled log so skew
// use is visible in metrics); past exp+skew it is dead.
const qstashExpSkew = 60 * time.Second

// VerifyQStashSignature checks a delivery's upstash-signature against
// the raw body bytes. The signature covers the exact bytes of the body,
// so callers must pass them unmodified. expectedSub binds the token to
// this deployment's destination URL ({APP_URL}/api/jobs/{queue}): the
// signing keys are account-scoped, so without the check a delivery
// signed for another destination in the same QStash account could be
// replayed here. Empty expectedSub skips the check (tests, legacy).
func VerifyQStashSignature(body []byte, signature, currentSigningKey, nextSigningKey, expectedSub string) bool {
	if signature == "" {
		return false
	}
	claims, ok := verifyWithKey(signature, currentSigningKey)
	if !ok {
		claims, ok = verifyWithKey(signature, nextSigningKey)
	}
	if !ok {
		return false
	}
	// Destination binding: the sub claim names the URL QStash was told
	// to deliver to. A token minted for a different destination in the
	// same account must not verify here.
	if expectedSub != "" && claims.Sub != expectedSub {
		return false
	}
	// Body hash: base64url(SHA-256(body)), padding-insensitive compare.
	sum := sha256.Sum256(body)
	bodyHash := strings.TrimRight(base64.RawURLEncoding.EncodeToString(sum[:]), "=")
	if strings.TrimRight(claims.Body, "=") != bodyHash {
		return false
	}
	return true
}

func verifyWithKey(signature, key string) (*qstashClaims, bool) {
	parts := strings.Split(signature, ".")
	if len(parts) != 3 {
		return nil, false
	}
	headerJSON, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, false
	}
	var header qstashHeader
	if err := json.Unmarshal(headerJSON, &header); err != nil {
		return nil, false
	}
	// Algorithm pinned to HS256: this account's QStash signs HS256, and
	// a verifier that honors whatever alg the (attacker-supplied)
	// header names invites algorithm-confusion. aud/typ are not checked
	// — QStash does not set them meaningfully for this flow.
	if header.Alg != "HS256" {
		return nil, false
	}
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(parts[0] + "." + parts[1]))
	expected := mac.Sum(nil)
	// Compare raw decoded bytes — comparing the base64 strings would
	// leak the encoded length before the content.
	got, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || subtle.ConstantTimeCompare(expected, got) != 1 {
		return nil, false
	}

	claimsJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, false
	}
	var claims qstashClaims
	if err := json.Unmarshal(claimsJSON, &claims); err != nil {
		return nil, false
	}
	// jose checks: issuer must match; exp/nbf honored (0 clock
	// tolerance, mirroring the TS route).
	if claims.Iss != "Upstash" {
		return nil, false
	}
	now := time.Now().Unix()
	if claims.Exp != 0 {
		if skew := now - claims.Exp; skew > int64(qstashExpSkew.Seconds()) {
			return nil, false
		} else if skew > 0 {
			logx.WarnEvery(5*time.Minute, "qstash signature accepted within exp skew", map[string]any{
				"skewS": skew,
			})
		}
	}
	if claims.Nbf != 0 && now < claims.Nbf {
		return nil, false
	}
	return &claims, true
}

// hmacForAlg was removed when the algorithm was pinned to HS256 — a
// verifier that honors the alg the (attacker-supplied) header names
// invites algorithm confusion.

// TraceIDFromRequest reads the trace-id header forwarded by QStash.
// The publisher sets Upstash-Trace-Id on
// the publish request; QStash forwards Upstash-* headers to the
// destination. Returns "" when absent (sweeper re-publish, legacy).
func TraceIDFromRequest(r *http.Request) string {
	return r.Header.Get("Upstash-Trace-Id")
}
