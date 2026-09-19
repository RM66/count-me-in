package jobs

import (
	"net/url"
)

// Every URL that appears in a notification. Each one encodes a routing
// decision from docs/pages.md that should not be re-derived by hand in
// each template.

// CabinetSlotPath — cabinet bookings, filtered to one slot. Relative
// on purpose: this is the `next` stored inside a login-link payload,
// and the redirect happens after the session is established.
func CabinetSlotPath(timeSlotID string) string {
	return "/cabinet/bookings?slot=" + url.QueryEscape(timeSlotID)
}

// LoginLinkURL — the one-time login link that establishes a session
// and then opens `next`.
func LoginLinkURL(appURL, token string) string {
	return appURL + "/login/link/" + url.PathEscape(token)
}

// ManageBookingURL — the guest's booking management page; their
// manageToken is the credential.
func ManageBookingURL(appURL, manageToken string) string {
	return appURL + "/booking/" + url.PathEscape(manageToken)
}

// OrganizerPageURL — the organizer's public page, offered to a
// cancelled guest as a way to rebook.
func OrganizerPageURL(appURL, slug string) string {
	return appURL + "/" + url.PathEscape(slug)
}
