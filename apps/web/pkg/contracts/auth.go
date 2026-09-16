package contracts

// AuthTicketPayload is the identity stored in a Redis auth ticket
// (ADR-008): validated server-side via the Telegram widget HMAC.
type AuthTicketPayload struct {
	Messenger      string  `json:"messenger"`
	MessengerID    string  `json:"messengerId"`
	DisplayName    string  `json:"displayName"`
	PhotoURL       *string `json:"photoUrl,omitempty"`
	MessengerLogin *string `json:"messengerLogin,omitempty"`
}

// GuestTicketResponse is POST /api/auth/telegram-guest's body.
type GuestTicketResponse struct {
	Ticket      string `json:"ticket"`
	Messenger   string `json:"messenger"`
	MessengerID string `json:"messengerId"`
	DisplayName string `json:"displayName"`
}

// AuthTicketResponse is POST /api/auth/telegram-signup's body.
type AuthTicketResponse struct {
	Ticket          string `json:"ticket"`
	OrganizerExists bool   `json:"organizerExists"`
}

// One-time login links: minted by the notification job, consumed on
// POST /login/link/{token}. The key and payload shape are contracts so
// both halves cannot drift.

const LoginLinkTTLSeconds = 30 * 24 * 60 * 60

func LoginLinkKey(token string) string {
	return "auth:login-link:" + token
}

// LoginLinkPayload — `next` is stored with the token, never in the URL,
// so the redirect target cannot be rewritten by whoever holds the link.
type LoginLinkPayload struct {
	OrganizerID string `json:"organizerId"`
	Next        string `json:"next"`
}
