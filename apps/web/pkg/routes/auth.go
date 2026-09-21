package routes

import (
	"errors"
	"net/http"
	"time"

	gen "countmein/pkg/api/gen"
	"countmein/pkg/auth"
	"countmein/pkg/db"
	"countmein/pkg/httpx"
	"countmein/pkg/i18n"
)

// TelegramGuest — POST /api/auth/telegram-guest: the guest half of
// widget auth (ADR-002, ADR-008). Validates the Telegram Login Widget
// payload and issues a short-lived ticket proving the messenger
// identity. Deliberately not the same endpoint as telegram-signup: a
// guest gets no session at all — the ticket is spent on one booking or
// one lookup, and sharing the route would let a guest tap be redeemed
// as an organizer sign-in. The identity is echoed back so the booking
// form can prefill the name; the booking endpoint re-reads it from
// the ticket server-side and never trusts the echo (invariant 8).
func TelegramGuest(w http.ResponseWriter, r *http.Request) {
	locale := i18n.DetectLocale(r)
	if !httpx.RateLimited(w, r, "rl:guest:"+httpx.ClientIP(r), httpx.RateLimitConfig{Limit: 10, Window: time.Minute}) {
		return
	}

	body, _ := httpx.ReadBody(r)
	identity, err := auth.ValidateTelegramWidget(body)
	switch {
	case errors.Is(err, auth.ErrTelegramNotConfigured):
		httpx.Error(http.StatusInternalServerError, locale, "telegramNotConfigured").Write(w)
		return
	case errors.Is(err, auth.ErrTelegramInvalid):
		httpx.Error(http.StatusBadRequest, locale, "telegramInvalid").Write(w)
		return
	case err != nil:
		httpx.Error(http.StatusBadRequest, locale, "telegramValidationFailed").Write(w)
		return
	}

	ticket, err := auth.IssueTicket(r.Context(), identity.ToTicketPayload())
	if err != nil {
		httpx.Internal(err).Write(w)
		return
	}

	httpx.JSON(http.StatusOK, gen.GuestTicketResponse{
		Ticket:      ticket,
		Messenger:   gen.Messenger(identity.Messenger),
		MessengerID: identity.MessengerID,
		DisplayName: identity.DisplayName,
	}).Write(w)
}

// TelegramSignup — POST /api/auth/telegram-signup: validates the widget
// payload via HMAC, then returns {organizerExists, ticket} so the
// client either signs in directly or proceeds to the profile step
// without re-authenticating. The organizer is not created here — the
// profile form POSTs to /api/organizers.
func TelegramSignup(w http.ResponseWriter, r *http.Request) {
	locale := i18n.DetectLocale(r)
	if !httpx.RateLimited(w, r, "rl:signup:"+httpx.ClientIP(r), httpx.RateLimitConfig{Limit: 5, Window: time.Minute}) {
		return
	}

	body, _ := httpx.ReadBody(r)
	identity, err := auth.ValidateTelegramWidget(body)
	switch {
	case errors.Is(err, auth.ErrTelegramNotConfigured):
		httpx.Error(http.StatusInternalServerError, locale, "telegramNotConfigured").Write(w)
		return
	case errors.Is(err, auth.ErrTelegramInvalid):
		httpx.Error(http.StatusBadRequest, locale, "telegramInvalid").Write(w)
		return
	case err != nil:
		httpx.Error(http.StatusBadRequest, locale, "telegramValidationFailed").Write(w)
		return
	}

	exists, err := db.ExistsOrganizerByMessenger(r.Context(), identity.Messenger, identity.MessengerID)
	if err != nil {
		httpx.Internal(err).Write(w)
		return
	}

	ticket, err := auth.IssueTicket(r.Context(), identity.ToTicketPayload())
	if err != nil {
		httpx.Internal(err).Write(w)
		return
	}

	httpx.JSON(http.StatusOK, gen.AuthTicketResponse{
		Ticket:          ticket,
		OrganizerExists: exists,
	}).Write(w)
}
