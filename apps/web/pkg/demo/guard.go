// Package demo enforces the read-only demo organizer server-side
// (ADR-010): disabled inputs in the cabinet are UX, not enforcement —
// anyone can call the API directly, so every write path goes through
// a guard here. Two ways to be "demo": an anonymous visitor (no
// session — /cabinet is open to everyone) or a session carrying the
// demo id. Both are treated identically.
package demo

import (
	"countmein/internal/contracts"
)

// DemoReadOnlyError — the throwing variant for use inside service-layer
// functions and transactions, where returning a response is not
// possible. English message on purpose: logs get this class, the
// response body gets localized copy (ADR-011).
type DemoReadOnlyError struct{}

func (DemoReadOnlyError) Error() string {
	return contracts.DemoReadOnlyMessage
}

// IsReadOnly is true for anonymous (organizerID "") and for the demo
// account itself. Call on every write path, including guest-facing
// ones.
func IsReadOnly(organizerID string) bool {
	return organizerID == "" || contracts.IsDemoOrganizerID(organizerID)
}

// AssertNotDemo returns DemoReadOnlyError when organizerID is the demo
// account or absent (anonymous — i.e. a demo cabinet visitor).
func AssertNotDemo(organizerID string) error {
	if IsReadOnly(organizerID) {
		return DemoReadOnlyError{}
	}
	return nil
}
