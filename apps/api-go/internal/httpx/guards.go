package httpx

import (
	"context"
	"io"
	"net/http"

	"api-go/internal/auth"
	"api-go/internal/contracts"
	"api-go/internal/demo"
	"api-go/internal/i18n"
	"api-go/internal/logx"
)

// RequireWritableOrganizer — who is allowed to *write* in this request.
// Anonymous callers are demo-cabinet visitors (/cabinet needs no
// session, ADR-010), so they get the same DEMO_READ_ONLY refusal as
// the demo id itself rather than a bare 401. The policy lives in
// internal/demo; this is its request-level door.
//
// Returns ("", non-nil resp) on refusal — resp is already rendered,
// the caller writes it and returns.
func RequireWritableOrganizer(r *http.Request) (organizerID string, resp *Response) {
	organizerID = auth.SessionOrganizerID(r)
	if demo.IsReadOnly(organizerID) {
		return "", DemoReadOnly(i18n.DetectLocale(r))
	}
	return organizerID, nil
}

// RequireGuestIdentity redeems a guest auth ticket for the messenger
// identity behind it — the guest counterpart of RequireWritableOrganizer.
// The ticket is consumed (GETDEL), not peeked: single-use, so a
// replayed request finds nothing and is refused. The only way a guest
// identity may enter a write: invariant 8 says it comes from a
// server-validated widget payload, never from raw client input.
func RequireGuestIdentity(ctx context.Context, r *http.Request, ticket string) (payload *contracts.AuthTicketPayload, resp *Response) {
	locale := i18n.DetectLocale(r)
	payload, err := auth.ConsumeTicket(ctx, ticket)
	if err != nil {
		return nil, Empty(http.StatusInternalServerError)
	}
	if payload == nil {
		return nil, ErrorParams(http.StatusUnauthorized, locale, "ticketExpired", nil)
	}
	return payload, nil
}

// ReadBody reads the raw request body, bounded at 1MB. Read failures
// are logged here (callers ignore the error — a partial body fails
// JSON parsing and answers 400, which is the right outcome for a
// truncated request); an oversize body is truncated by the limit and
// fails parsing the same way.
func ReadBody(r *http.Request) ([]byte, error) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		logx.Error(err, map[string]any{"scope": "read-body"})
	}
	return body, err
}
