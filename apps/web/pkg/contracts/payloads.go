package contracts

import (
	gen "countmein/pkg/api/gen"
)

// Hand-written Redis payload types (ADR-016). These never travel over HTTP —
// they are cached in Redis behind auth tickets and login links — so the
// OpenAPI document only lists them under x-internal and oapi-codegen does
// not emit Go types for them. Ordinary application code, like the rest of
// this package's hand-written surface.

// AuthTicketPayload is the identity cached in Redis behind an auth ticket
// (ADR-008). The Go writer (auth/ticket.go) and the TS reader
// (server/auth/ticket.ts) share the shape; parity is pinned by the golden
// sample AuthTicketPayload.json.
type AuthTicketPayload struct {
	Messenger      gen.Messenger `json:"messenger"`
	MessengerID    string        `json:"messengerId"`
	DisplayName    string        `json:"displayName"`
	PhotoURL       *string       `json:"photoUrl,omitempty"`
	MessengerLogin *string       `json:"messengerLogin,omitempty"`
	// Purpose binds the ticket to one flow:
	// "guest" tickets redeem only in booking endpoints, "organizer"
	// tickets only in registration. Parity: `purpose` in
	// packages/contracts/src/auth.ts.
	Purpose string `json:"purpose"`
}

// LoginLinkPayload is what a one-time login link resolves to once consumed.
// `next` is stored with the token (not in the URL) so the redirect target
// cannot be rewritten by whoever holds the link.
type LoginLinkPayload struct {
	OrganizerID string `json:"organizerId"`
	Next        string `json:"next"`
}
