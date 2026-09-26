package validation

import (
	"net/url"
	"strings"
	"time"

	"countmein/pkg/contracts"

	// Embedded tz database so time.LoadLocation works on any runtime
	// (Vercel containers ship no system tzdata).
	_ "time/tzdata"
)

// Hand-written validation rules: everything the OpenAPI spec cannot
// express (ADR-016). Bounds, enums, patterns (uuid, serviceId, slug shape)
// and required-ness come from the spec via kin-openapi (spec.go); these are
// the leftovers. Pinned by packages/contracts/vectors/validation/*.

// Reserved slugs (ADR-009): path segments the public booking page can never
// be served from. The slug *shape* is a spec pattern; reserved-ness is a
// policy only the code knows.
var reservedSlugs = map[string]bool{
	"api":     true,
	"booking": true,
	"cabinet": true,
	"signup":  true,
	"login":   true,
	"terms":   true,
	"privacy": true,
	"demo":    true,
}

// IsReservedSlug reports path segments the public booking page can never
// be served from (including "demo" — the demo organizer's own slug).
func IsReservedSlug(v string) bool {
	return reservedSlugs[strings.ToLower(v)]
}

func TimezoneRule(v string) string {
	if !isValidTimezone(v) {
		return "Invalid IANA timezone"
	}
	return ""
}

// isValidTimezone mirrors Intl.DateTimeFormat's lookup, which matches IANA ids
// case-insensitively: try the exact id, then a re-cased form ("europe/belgrade"
// → "Europe/Belgrade"). "Local" is Go-specific and deliberately rejected so
// the two sides accept the same set.
func isValidTimezone(v string) bool {
	if v == "" || strings.EqualFold(v, "local") {
		return false
	}
	if _, err := time.LoadLocation(v); err == nil {
		return true
	}
	if _, err := time.LoadLocation(canonicalizeTimezone(v)); err == nil {
		return true
	}
	return false
}

// canonicalizeTimezone restores the conventional casing of an IANA id by
// upper-casing the first letter of every slash- and underscore-separated segment.
func canonicalizeTimezone(v string) string {
	segments := strings.Split(v, "/")
	for i, segment := range segments {
		parts := strings.Split(segment, "_")
		for j, part := range parts {
			if part == "" {
				continue
			}
			r := []rune(part)
			parts[j] = strings.ToUpper(string(r[0])) + strings.ToLower(string(r[1:]))
		}
		segments[i] = strings.Join(parts, "_")
	}
	return strings.Join(segments, "/")
}

func ValidURL(v string) bool {
	u, err := url.Parse(v)
	if err != nil {
		return false
	}
	// http/https only: the value is rendered as a link, and other
	// schemes (javascript:, data:, mailto:) are either dangerous or
	// not a web link at all.
	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}
	return u.Host != ""
}

// URLRule — the spec carries only `format: uri`, which kin-openapi does not
// enforce; the shape check stays here.
func URLRule(v string) string {
	if !ValidURL(v) {
		return "Invalid input: expected URL"
	}
	return ""
}

func isAcceptableSlotStart(startsAtTime time.Time) bool {
	return startsAtTime.After(time.Now().Add(-time.Duration(contracts.SlotStartToleranceMS) * time.Millisecond))
}
