package validation

// Primitive validators, ported from packages/contracts/src/primitives.ts.

import (
	"fmt"
	"net/url"
	"regexp"
	"time"

	"countmein/internal/contracts"

	// Embedded tz database so time.LoadLocation works on any runtime
	// (Vercel containers ship no system tzdata).
	_ "time/tzdata"

	"github.com/google/uuid"
)

var slugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

var serviceIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{6,32}$`)

// Reserved slugs that conflict with system routes (ADR-009) or with
// the seeded demo organizer (ADR-010).
var reservedSlugs = map[string]bool{
	"api":                       true,
	"booking":                   true,
	"cabinet":                   true,
	"signup":                    true,
	"login":                     true,
	"terms":                     true,
	"privacy":                   true,
	contracts.DemoOrganizerSlug: true,
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

// SlugRule checks the transformed slug (already trimmed+lowercased).
func SlugRule(v string) string {
	if len(v) < 4 || len(v) > 40 {
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
	if _, err := time.LoadLocation(v); err != nil {
		return "Invalid IANA timezone"
	}
	return ""
}

func DisplayNameRule(v string) string {
	if len(v) < 1 || len(v) > 100 {
		return "String must contain between 1 and 100 characters"
	}
	return ""
}

func PriceRule(v string) string {
	if len(v) < 1 || len(v) > 50 {
		return "String must contain between 1 and 50 characters"
	}
	return ""
}

// OrganizerDescription may be empty (no min in the TS schema).
func OrganizerDescriptionRule(v string) string {
	if len(v) > 4000 {
		return "String must contain at most 4000 characters"
	}
	return ""
}

func ServiceDescriptionRule(v string) string {
	if len(v) > 2000 {
		return "String must contain at most 2000 characters"
	}
	return ""
}

func LocationRule(v string) string {
	if len(v) < 1 || len(v) > 300 {
		return "String must contain between 1 and 300 characters"
	}
	return ""
}

func ContactRule(v string) string {
	if len(v) < 1 || len(v) > 300 {
		return "String must contain between 1 and 300 characters"
	}
	return ""
}

func OptionLabelRule(v string) string {
	if len(v) < 1 || len(v) > 100 {
		return "String must contain between 1 and 100 characters"
	}
	return ""
}

func ManageTokenRule(v string) string {
	if len(v) < 10 || len(v) > 200 {
		return "String must contain between 10 and 200 characters"
	}
	return ""
}

func MessengerIDRule(v string) string {
	if len(v) < 1 || len(v) > 100 {
		return "String must contain between 1 and 100 characters"
	}
	return ""
}

// AuthTicketRule — opaque short-lived token proving messenger identity.
func AuthTicketRule(v string) string {
	if len(v) < 20 || len(v) > 200 {
		return "String must contain between 20 and 200 characters"
	}
	return ""
}

func intRange(min, max int64) func(int64) string {
	return func(n int64) string {
		if n < min || n > max {
			return fmt.Sprintf("Value must be between %d and %d", min, max)
		}
		return ""
	}
}

func localeRule(v string) string {
	if !contracts.IsAppLocale(v) {
		return "Invalid input: expected one of " + stringsJoin(contracts.Locales, "|")
	}
	return ""
}

func stringsJoin(parts []string, sep string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += sep
		}
		out += p
	}
	return out
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

func ContentTypeRule(v string) string {
	switch v {
	case "image/jpeg", "image/png", "image/webp":
		return ""
	}
	return "Invalid input: expected one of image/jpeg|image/png|image/webp"
}
