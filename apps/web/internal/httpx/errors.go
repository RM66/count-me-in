package httpx

import (
	"net/http"

	"countmein/internal/db"
	"countmein/internal/demo"
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
func BookingErrorResponse(err error, locale string) *Response {
	switch e := err.(type) {
	case demo.DemoReadOnlyError:
		return DemoReadOnly(locale)
	case db.SlotNotBookableError:
		return Error(http.StatusNotFound, locale, "slotGone")
	case db.SlotSoldOutError:
		// seatsLeft travels with it so the dialog can say how many are
		// actually left rather than only that the attempt failed.
		if e.SeatsLeft == 0 {
			return ErrorExtras(http.StatusConflict, locale, "soldOut", nil,
				map[string]any{"seatsLeft": 0})
		}
		return ErrorExtras(http.StatusConflict, locale, "seatsLeftOnSession",
			map[string]any{"count": e.SeatsLeft},
			map[string]any{"seatsLeft": e.SeatsLeft})
	case db.DuplicateBookingError:
		return ErrorExtras(http.StatusConflict, locale, "duplicateBooking", nil,
			map[string]any{"code": "duplicate_booking"})
	case db.BookingAlreadyCancelledError:
		return Error(http.StatusConflict, locale, "alreadyCancelled")
	case db.InvalidOptionSelectionError:
		// The class message carries the English validation detail for
		// logs; the body gets the machine-readable code plus localized
		// copy, and the booking dialog re-renders it from the code.
		return ErrorExtras(http.StatusBadRequest, locale, "invalidOptions", nil,
			map[string]any{"code": "invalid_option"})
	case db.PartyTooLargeError:
		return ErrorExtras(http.StatusBadRequest, locale, "partyTooLarge",
			map[string]any{"maxSeats": e.MaxSeats},
			map[string]any{"maxSeats": e.MaxSeats})
	}
	return nil
}

// SlotErrorResponse maps the slot route's two inline errors — one
// handler, no risk of disagreeing with itself (mirrors the TS note).
func SlotErrorResponse(err error, locale string) *Response {
	switch err.(type) {
	case db.NoSlotUpdatesError:
		return Error(http.StatusBadRequest, locale, "nothingToUpdate")
	case db.SlotCapacityBelowBookedError:
		// The payload is well-formed, it conflicts with current state.
		e := err.(db.SlotCapacityBelowBookedError)
		return ErrorParams(http.StatusConflict, locale, "capacityBelowBooked",
			map[string]any{"count": e.BookedCount})
	case db.SlotHasActiveBookingsError:
		// The slot still has confirmed bookings — the organizer must
		// cancel them before the slot can be deleted.
		return Error(http.StatusConflict, locale, "slotHasActiveBookings")
	}
	return nil
}

// ServiceErrorResponse maps the service route's inline error.
func ServiceErrorResponse(err error, locale string) *Response {
	switch err.(type) {
	case db.NoServiceUpdatesError:
		return Error(http.StatusBadRequest, locale, "nothingToUpdate")
	}
	return nil
}

// OrganizerErrorResponse maps the organizer route's inline error.
func OrganizerErrorResponse(err error, locale string) *Response {
	switch err.(type) {
	case db.NoOrganizerUpdatesError:
		return Error(http.StatusBadRequest, locale, "nothingToUpdate")
	}
	return nil
}
