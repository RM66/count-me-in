package contracts

import "strings"

// Demo organizer account (ADR-010). Demo-ness is a code constant, not
// a database column, shared by every layer that must recognize it.

const DemoOrganizerID = "01930000-0000-7000-8000-0000000000de"

const DemoOrganizerSlug = "demo"

// Deterministic demo service ids (public URLs /demo/{serviceId}).
const (
	DemoServiceYoga       = "demo-yoga"
	DemoServicePottery    = "demo-pottery"
	DemoServiceBreathwork = "demo-breathwork"
)

// Machine-readable error code returned by write paths that touch demo data.
const DemoReadOnlyCode = "DEMO_READ_ONLY"

// User-facing copy for a rejected write against the demo account.
const DemoReadOnlyMessage = "This is a read-only demo account — sign up to create your own bookable services."

// IsDemoOrganizerID — call on every write path, including guest-facing ones.
func IsDemoOrganizerID(organizerID string) bool {
	return organizerID == DemoOrganizerID
}

func IsDemoOrganizerSlug(slug string) bool {
	return strings.ToLower(slug) == DemoOrganizerSlug
}
