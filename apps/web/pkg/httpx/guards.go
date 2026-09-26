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
// authenticated, so this is abuse protection, not auth. The bucket is
// consulted *before* the demo refusal: anonymous and demo callers are
// refused with a cheap 403, and without the limiter that refusal would
// be hammerable for free (anonymous callers bucket by IP, since they
// share no id).
//
// Reads are deliberately unmetered here — read limiting is delegated
// to the edge (Vercel), which absorbs anonymous scraping before it
// reaches the function.
//
// Returns ("", non-nil resp) on refusal — resp is already rendered,
// the caller writes it and returns.
func RequireWritableOrganizer(r *http.Request) (organizerID string, resp *Response) {
	organizerID = auth.SessionOrganizerID(r)
	bucket := "rl:organizer-write:" + organizerID
	if organizerID == "" {
		bucket = "rl:organizer-write:anon:" + ClientIP(r)
	}
	allowed, retryAfter := Allow(r.Context(), bucket, RateLimitConfig{Limit: 60, Window: time.Minute})
	if !allowed {
		return "", TooManyRequests(i18n.DetectLocale(r), retryAfter)
	}
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
		logx.Error(err, map[string]any{"scope": "consume-ticket"})
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

// ReadBodyOr413 reads the raw request body, bounded at 1MB, and
// answers 413 when the body exceeds the bound. Returns
// (body, true) when the caller may proceed; (nil, false) when the
// 413 has already been written and the caller must return. A
// truncated body would otherwise surface as a confusing 400
// "invalid JSON" instead of the honest size refusal.
func ReadBodyOr413(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	const maxBody = 1 << 20
	limited := io.LimitReader(r.Body, maxBody+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		logx.Error(err, map[string]any{"scope": "read-body"})
		Error(http.StatusBadRequest, i18n.DetectLocale(r), "invalidBody").Write(w)
		return nil, false
	}
	if len(body) > maxBody {
		w.Header().Set("Connection", "close")
		Error(http.StatusRequestEntityTooLarge, i18n.DetectLocale(r), "bodyTooLarge").Write(w)
		return nil, false
	}
	return body, true
}
