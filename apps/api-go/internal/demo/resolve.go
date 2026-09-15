package demo

import (
	"net/http"

	"api-go/internal/auth"
	"api-go/internal/contracts"
)

// ResolveCabinetOrganizerID returns the organizer whose data the
// cabinet should show for this request: the signed-in organizer, or
// the demo organizer when there is no session. isDemo travels with the
// id so callers never re-derive it.
func ResolveCabinetOrganizerID(r *http.Request) (organizerID string, isDemo bool) {
	if s := auth.SessionFromRequest(r); s != nil {
		return s.OrganizerID, contracts.IsDemoOrganizerID(s.OrganizerID)
	}
	return contracts.DemoOrganizerID, true
}
