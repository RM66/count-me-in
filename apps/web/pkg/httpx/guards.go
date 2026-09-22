package httpx

import (
	"context"
	"io"
	"net/http"
	"time"

	"countmein/pkg/auth"
	"countmein/pkg/contracts"
	"countmein/pkg/demo"
	"countmein/pkg/i18n"
	"countmein/pkg/logx"
)

// RequireWritableOrganizer — who is allowed to *write* in this request.
// Anonymous callers are demo-cabinet visitors (/cabinet needs no
// session, ADR-010), so they get the same DEMO_READ_ONLY refusal as
// the demo id itself rather than a bare 401. The policy lives in
// pkg/demo; this is its request-level door.
//
// Every organizer write also passes a per-organizer rate bucket:
// the cabinet CRUD routes had no limits at
// all, so a runaway client could hammer the API unthrottled. The
// bucket is keyed by organizer id — a signed-in organizer is already
// authenticated, so this is abuse protection, not auth.
//
// Returns ("", non-nil resp) on refusal — resp is already rendered,
// the caller writes it and returns.
func RequireWritableOrganizer(r *http.Request) (organizerID string, resp *Response) {
	organizerID = auth.SessionOrganizerID(r)
	if demo.IsReadOnly(organizerID) {
		return "", DemoReadOnly(i18n.DetectLocale(r))
	}
	if organizerID != "" {
		allowed, retryAfter := Allow(r.Context(), "rl:organizer-write:"+organizerID, RateLimitConfig{Limit: 60, Window: time.Minute})
		if !allowed {
			return "", TooManyRequests(i18n.DetectLocale(r), retryAfter)
		}
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
	// Purpose claim: a ticket minted for
	// organizer registration must not be redeemable in the booking
	// flow. Answered like an expired one — the caller cannot
	// distinguish "wrong flow" from "unknown ticket".
	if payload == nil || payload.Purpose != auth.TicketPurposeGuest {
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
