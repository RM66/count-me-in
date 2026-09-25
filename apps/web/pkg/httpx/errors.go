package httpx

import (
	"errors"
	"net/http"

	gen "countmein/pkg/api/gen"
	"countmein/pkg/db"
	"countmein/pkg/demo"
)

// BookingErrorResponse maps booking failure modes onto HTTP responses
// (port of the TS _error-response.ts). Returns nil for anything else,
// so an unexpected error keeps propagating as a 500 instead of being
// flattened into a misleading 4xx.
//
// Status codes carry meaning:
//   - 403 demo account — correctly identified, action forbidden
//   - 404 slot/service gone — nothing to book
//   - 409 sold out / already cancelled / duplicate — well-formed
//     request, conflicting state
//   - 400 invalid option selection / party over the per-booking cap
//
// errors.As, not a type switch: wrapped errors must not slip past the
// mapping into a bare 500 (applied to every mapper in this file).
func BookingErrorResponse(err error, locale string) *Response {
	var readOnly demo.DemoReadOnlyError
	if errors.As(err, &readOnly) {
		return DemoReadOnly(locale)
	}
	var notBookable db.SlotNotBookableError
	if errors.As(err, &notBookable) {
		return Error(http.StatusNotFound, locale, "slotGone")
	}
	var soldOut db.SlotSoldOutError
	if errors.As(err, &soldOut) {
		// seatsLeft travels with it so the dialog can say how many are
		// actually left rather than only that the attempt failed.
		if soldOut.SeatsLeft == 0 {
			return ErrorExtras(http.StatusConflict, locale, "soldOut", nil,
				gen.ErrorBody{SeatsLeft: ptr(0)})
		}
		return ErrorExtras(http.StatusConflict, locale, "seatsLeftOnSession",
			map[string]any{"count": soldOut.SeatsLeft},
			gen.ErrorBody{SeatsLeft: ptr(soldOut.SeatsLeft)})
	}
	var duplicate db.DuplicateBookingError
	if errors.As(err, &duplicate) {
		return ErrorExtras(http.StatusConflict, locale, "duplicateBooking", nil,
			gen.ErrorBody{Code: ptr("duplicate_booking")})
	}
	var alreadyCancelled db.BookingAlreadyCancelledError
	if errors.As(err, &alreadyCancelled) {
		return Error(http.StatusConflict, locale, "alreadyCancelled")
	}
	var tokenExpired db.ManageTokenExpiredError
	if errors.As(err, &tokenExpired) {
		// Answered like an unknown token (404) so the endpoint cannot
		// be used to test whether a token exists.
		return Error(http.StatusNotFound, locale, "bookingNotFound")
	}
	var invalidOptions db.InvalidOptionSelectionError
	if errors.As(err, &invalidOptions) {
		// The class message carries the English validation detail for
		// logs; the body gets the machine-readable code plus localized
		// copy, and the booking dialog re-renders it from the code.
		return ErrorExtras(http.StatusBadRequest, locale, "invalidOptions", nil,
			gen.ErrorBody{Code: ptr("invalid_option")})
	}
	var partyTooLarge db.PartyTooLargeError
	if errors.As(err, &partyTooLarge) {
		return ErrorExtras(http.StatusBadRequest, locale, "partyTooLarge",
			map[string]any{"maxSeats": partyTooLarge.MaxSeats},
			gen.ErrorBody{MaxSeats: ptr(partyTooLarge.MaxSeats)})
	}
	return nil
}

// SlotErrorResponse maps the slot route's two inline errors — one
// handler, no risk of disagreeing with itself (mirrors the TS note).
// errors.As, not type switches: wrapped errors must not slip past the
// mapping into a bare 500 (applied to every mapper in this file).
func SlotErrorResponse(err error, locale string) *Response {
	var noUpdates db.NoSlotUpdatesError
	if errors.As(err, &noUpdates) {
		return Error(http.StatusBadRequest, locale, "nothingToUpdate")
	}
	var belowBooked db.SlotCapacityBelowBookedError
	if errors.As(err, &belowBooked) {
		// The payload is well-formed, it conflicts with current state.
		return ErrorParams(http.StatusConflict, locale, "capacityBelowBooked",
			map[string]any{"count": belowBooked.BookedCount})
	}
	var hasBookings db.SlotHasActiveBookingsError
	if errors.As(err, &hasBookings) {
		// The slot is referenced by booking rows (confirmed or
		// cancelled) — a booked slot cannot be deleted (no path removes
		// the rows; cancelled bookings are kept as guest history).
		return Error(http.StatusConflict, locale, "slotHasActiveBookings")
	}
	return nil
}

// ServiceErrorResponse maps the service route's inline errors.
// errors.As, not a type switch: wrapped errors must not slip past the
// mapping into a bare 500.
func ServiceErrorResponse(err error, locale string) *Response {
	var noUpdates db.NoServiceUpdatesError
	if errors.As(err, &noUpdates) {
		return Error(http.StatusBadRequest, locale, "nothingToUpdate")
	}
	var hasBookings db.ServiceHasBookingsError
	if errors.As(err, &hasBookings) {
		// A booking row (confirmed or cancelled) references one of the
		// service's slots — deleting would lose guest records.
		return Error(http.StatusConflict, locale, "serviceHasBookings")
	}
	return nil
}

// OrganizerErrorResponse maps the organizer route's inline error.
// errors.As, not a type switch: wrapped errors must not slip past the
// mapping into a bare 500.
func OrganizerErrorResponse(err error, locale string) *Response {
	var noUpdates db.NoOrganizerUpdatesError
	if errors.As(err, &noUpdates) {
		return Error(http.StatusBadRequest, locale, "nothingToUpdate")
	}
	var notFound db.OrganizerNotFoundError
	if errors.As(err, &notFound) {
		return Error(http.StatusNotFound, locale, "organizerNotFound")
	}
	return nil
}
