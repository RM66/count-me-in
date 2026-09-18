package validation

import (
	"fmt"
	"net/url"
	"strings"
	"time"

	"countmein/pkg/contracts"

	// Embedded tz database so time.LoadLocation works on any runtime
	// (Vercel containers ship no system tzdata).
	_ "time/tzdata"

	"github.com/google/uuid"
)

// Hand-written validation rules: everything the generator cannot derive from
// JSON Schema (see wire.ts x-go-rule). Derived length/int/enum rules live in
// validation_gen.go. Pinned by packages/contracts/vectors/validation/*.

// charLen counts UTF-16 code units, matching JavaScript String.length (and
// therefore Zod's .min()/.max()). Byte length would reject a valid 100-char
// Cyrillic title as "200 characters".
func charLen(v string) int {
	n := 0
	for _, r := range v {
		if r > 0xFFFF {
			n += 2
		} else {
			n++
		}
	}
	return n
}

func intRange(min, max int64) func(int64) string {
	return func(n int64) string {
		if n < min || n > max {
			return fmt.Sprintf("Value must be between %d and %d", min, max)
		}
		return ""
	}
}

func UUIDRule(v string) string {
	if _, err := uuid.Parse(v); err != nil {
		return "Invalid input: expected UUID"
	}
	return ""
}

func ServiceIDRule(v string) string {
	if !serviceIDPattern.MatchString(v) {
		return "Invalid service id"
	}
	return ""
}

func SlugRule(v string) string {
	v = strings.ToLower(v)
	if charLen(v) < 4 || charLen(v) > 40 {
		return "String must contain between 4 and 40 characters"
	}
	if !slugPattern.MatchString(v) {
		return "slug must be lowercase letters, digits and single hyphens"
	}
	if reservedSlugs[v] {
		return "this slug is reserved for system use — please choose another"
	}
	return ""
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
	return err == nil && u.Scheme != "" && (u.Host != "" || u.Opaque != "")
}

func URLRule(v string) string {
	if !ValidURL(v) {
		return "Invalid input: expected URL"
	}
	return ""
}

func isAcceptableSlotStart(startsAtTime time.Time) bool {
	return startsAtTime.After(time.Now().Add(-time.Duration(contracts.SlotStartToleranceMS) * time.Millisecond))
}
