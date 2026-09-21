package routes

import (
	"context"
	"net/http"
	"time"

	gen "countmein/pkg/api/gen"
	"countmein/pkg/contracts"
	"countmein/pkg/db"
	"countmein/pkg/httpx"
	"countmein/pkg/i18n"
	"countmein/pkg/logx"
	"countmein/pkg/queue"
	"countmein/pkg/validation"
)

// BookingCreate — POST /api/bookings: a guest reserves seats (ADR-002).
// The public write of the whole product, and the only one with no
// session: authorization is the short-lived ticket from
// /api/auth/telegram-guest, consumed here — which is what makes a
// replayed request fail rather than double-book. Only guestName, the
// slot and the options come from the body; the identity stored on the
// row is read from the ticket server-side (invariant 8). Seats are
// claimed by the atomic reserve in db.CreateGuestBooking (invariant 2).
func BookingCreate(w http.ResponseWriter, r *http.Request) {
	locale := i18n.DetectLocale(r)
	if !httpx.RateLimited(w, r, "rl:booking:"+httpx.ClientIP(r), httpx.RateLimitConfig{Limit: 5, Window: time.Minute}) {
		return
	}

	body, _ := httpx.ReadBody(r)
	input, errs := validation.DecodeCreateBookingInput(body)
	if errs != nil {
		httpx.WriteInvalidBody(w, locale, errs)
		return
	}

	identity, resp := httpx.RequireGuestIdentity(r.Context(), r, input.GuestTicket)
	if resp != nil {
		resp.Write(w)
		return
	}

	// Trace id (architecture review fix #5): correlates this request
	// across the async pipeline — the id travels in the QStash message
	// header and is emitted in every log line in both the API handler
	// and the job handler, so debugging "I booked but didn't get a
	// message" becomes a grep for one id.
	traceID := logx.NewTraceID()

	created, err := db.CreateGuestBooking(r.Context(), db.CreateBookingData{
		ServiceID:       input.ServiceID,
		TimeSlotID:      contracts.UUIDString(input.TimeSlotID),
		Seats:           input.Seats,
		GuestName:       input.GuestName,
		SelectedOptions: derefSlice(input.SelectedOptions),
		// DecodeCreateBookingInput applies the schema default, so the
		// pointer is never nil here; the fallback is belt-and-braces.
		GuestLocale: string(contracts.DerefOr(input.GuestLocale, gen.En)),
		Guest:       *identity,
	})
	if err != nil {
		logx.Error(err, map[string]any{"traceId": traceID, "scope": "booking-create"})
		// Sold out, gone, demo, bad options — all already have a status
		// code; anything else is a 500.
		if resp := httpx.BookingErrorResponse(err, locale); resp != nil {
			resp.Write(w)
			return
		}
		httpx.Internal(err).Write(w)
		return
	}

	logx.Info("booking created", map[string]any{
		"traceId":   traceID,
		"bookingId": created.ID,
	})

	// After-commit publish (ADR-012). No after()-hook exists on the
	// Vercel Go runtime, so the QStash round trip runs inline after the
	// response is written and before Handler returns — the guest does
	// not wait for QStash, but the function stays alive until the
	// publish completes (or the 1.5s context expires). The publisher
	// absorbs its own errors — the booking is already in.
	//
	// The response is flushed to the socket before the publish so the
	// guest sees the 201 immediately; the function then stays alive to
	// finish the (bounded) publish.
	httpx.JSON(http.StatusCreated, gen.GuestBookingEnvelope{Booking: *created}).Write(w)
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	publishCtx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	queue.PublishBookingCreated(publishCtx, contracts.UUIDString(created.ID), traceID)
}

// BookingLookup — POST /api/bookings/lookup: "find my bookings"
// (ADR-002, entry path 2). The fallback for a guest who lost the deep
// link: re-authenticate with the widget, get every booking of that
// messenger identity, each carrying its own manageToken. POST despite
// being a read: the ticket is a secret that must not land in a URL, and
// redeeming it mutates server state (single-use). The identity comes
// only from the ticket — a raw messengerId in the body would turn this
// into a way to read anyone's bookings.
func BookingLookup(w http.ResponseWriter, r *http.Request) {
	body, _ := httpx.ReadBody(r)
	input, errs := validation.DecodeLookupBookingsInput(body)
	if errs != nil {
		httpx.WriteInvalidBody(w, i18n.DetectLocale(r), errs)
		return
	}

	identity, resp := httpx.RequireGuestIdentity(r.Context(), r, input.GuestTicket)
	if resp != nil {
		resp.Write(w)
		return
	}

	bookings, err := db.ListGuestBookings(r.Context(), string(identity.Messenger), identity.MessengerID)
	if err != nil {
		httpx.Internal(err).Write(w)
		return
	}
	if bookings == nil {
		bookings = []gen.GuestBooking{}
	}
	httpx.JSON(http.StatusOK, gen.GuestBookingsEnvelope{Bookings: bookings}).Write(w)
}

// BookingCancel — POST /api/bookings/cancel: the guest cancels via
// their manageToken (ADR-002). The token is the credential: it reached
// the guest through their verified messenger account, so possession is
// proof of ownership and no session is involved. It travels in the
// body rather than the URL so it stays out of access logs, Referer
// headers and browser history. POST rather than DELETE: cancelling
// moves the booking to cancelled and releases the seats (invariant 1),
// and the response is the updated booking.
func BookingCancel(w http.ResponseWriter, r *http.Request) {
	locale := i18n.DetectLocale(r)

	traceID := logx.NewTraceID()

	body, _ := httpx.ReadBody(r)
	input, errs := validation.DecodeCancelBookingByTokenInput(body)
	if errs != nil {
		httpx.WriteInvalidBody(w, locale, errs)
		return
	}

	booking, err := db.CancelGuestBookingByToken(r.Context(), input.ManageToken)
	if err != nil {
		if resp := httpx.BookingErrorResponse(err, locale); resp != nil {
			resp.Write(w)
			return
		}
		httpx.Internal(err).Write(w)
		return
	}
	// Unknown token — answered exactly like a wrong one, so the
	// endpoint cannot be used to test whether a token exists.
	if booking == nil {
		httpx.Error(http.StatusNotFound, locale, "bookingNotFound").Write(w)
		return
	}

	logx.Info("booking cancelled by guest", map[string]any{
		"traceId":   traceID,
		"bookingId": booking.ID,
	})

	// After-commit notification (ADR-012): the organizer is told by
	// QStash delivery once the cancellation is durable; the publisher
	// never throws. No after()-hook exists on this runtime, so the
	// publish runs inline after the response is written and before
	// Handler returns under a bounded context — the guest does not
	// wait for QStash.
	httpx.JSON(http.StatusOK, gen.GuestBookingEnvelope{Booking: *booking}).Write(w)
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	publishCtx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	queue.PublishBookingCancelled(publishCtx, contracts.UUIDString(booking.ID), gen.CancelActorGuest, traceID)
}

// BookingCancelByOrganizer — POST /api/bookings/cancel-by-organizer:
// the organizer cancels a booking on one of their own services from
// the cabinet. Sibling of BookingCancel, kept separate because the
// credential differs: that one is authorized by the guest's manageToken
// and takes no session; this one by the organizer's session plus
// ownership of the service the booking hangs off. Folding both into
// one handler would mean a body that accepts either secret, and an
// endpoint that cancels on whichever it finds — the kind of branch
// where a missing check turns into cancelling someone else's booking.
func BookingCancelByOrganizer(w http.ResponseWriter, r *http.Request) {
	locale := i18n.DetectLocale(r)

	traceID := logx.NewTraceID()

	// Also refuses the demo account and anonymous cabinet visitors,
	// since /cabinet needs no session (ADR-010) — a route under it does
	// not imply an authenticated organizer.
	organizerID, resp := httpx.RequireWritableOrganizer(r)
	if resp != nil {
		resp.Write(w)
		return
	}

	body, _ := httpx.ReadBody(r)
	input, errs := validation.DecodeCancelBookingByOrganizerInput(body)
	if errs != nil {
		httpx.WriteInvalidBody(w, locale, errs)
		return
	}

	booking, err := db.CancelOwnedBooking(r.Context(), organizerID, contracts.UUIDString(input.BookingID))
	if err != nil {
		// Already cancelled → 409, demo → 403.
		if resp := httpx.BookingErrorResponse(err, locale); resp != nil {
			resp.Write(w)
			return
		}
		httpx.Internal(err).Write(w)
		return
	}
	// Unknown id and a booking on someone else's service are answered
	// identically, so the endpoint cannot probe for foreign ids.
	if booking == nil {
		httpx.Error(http.StatusNotFound, locale, "bookingNotFound").Write(w)
		return
	}

	logx.Info("booking cancelled by organizer", map[string]any{
		"traceId":   traceID,
		"bookingId": booking.ID,
	})

	// After-commit notification (ADR-012): the guest is told via QStash
	// delivery once the cancellation is durable. The publish runs inline
	// after the response is written and before Handler returns — the
	// organizer does not wait for QStash. The response is flushed first
	// so the organizer sees the 200 immediately.
	httpx.JSON(http.StatusOK, gen.BookingEnvelope{Booking: *booking}).Write(w)
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	publishCtx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	queue.PublishBookingCancelled(publishCtx, contracts.UUIDString(booking.ID), gen.CancelActorOrganizer, traceID)
}
