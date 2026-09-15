package validation

import (
	"encoding/json"

	"countmein/internal/contracts"
)

// ParseCreateBookingInput — port of createBookingInput. Guest identity
// is derived from the guestTicket server-side, never trusted from the
// body; selectedOptions is shape-validated here and checked against
// the concrete service inside the booking transaction (invariant 6).
func ParseCreateBookingInput(body []byte) (contracts.CreateBookingInput, *Errors) {
	m, e := rawObject(body)
	if e != nil {
		return contracts.CreateBookingInput{}, e
	}
	e = NewErrors()
	var out contracts.CreateBookingInput

	out.ServiceID, _ = strValue(e, m, "serviceId", true, false, ServiceIDRule)
	out.TimeSlotID, _ = strValue(e, m, "timeSlotId", true, false, UUIDRule)
	seats, _ := intValue(e, m, "seats", true, intRange(1, 1000))
	out.Seats = int(seats)
	out.GuestName, _ = strValue(e, m, "guestName", true, true, DisplayNameRule)
	out.GuestTicket, _ = strValue(e, m, "guestTicket", true, false, AuthTicketRule)
	out.SelectedOptions, _ = strArrValue(e, m, "selectedOptions", false, true, OptionLabelRule, 50)
	out.GuestLocale = guestLocaleOrDefault(e, m)

	return out, e.Finish()
}

// guestLocaleOrDefault — optional enum defaulting to the app default;
// the locale the guest's confirmation message is rendered in (ADR-011).
func guestLocaleOrDefault(e *Errors, m map[string]json.RawMessage) string {
	v, _ := strValue(e, m, "guestLocale", false, false, localeRule)
	if v == "" {
		return contracts.DefaultLocale
	}
	return v
}

// ParseCancelBookingByTokenInput — port of cancelBookingByTokenInput.
func ParseCancelBookingByTokenInput(body []byte) (contracts.CancelBookingByTokenInput, *Errors) {
	m, e := rawObject(body)
	if e != nil {
		return contracts.CancelBookingByTokenInput{}, e
	}
	e = NewErrors()
	var out contracts.CancelBookingByTokenInput
	out.ManageToken, _ = strValue(e, m, "manageToken", true, false, ManageTokenRule)
	return out, e.Finish()
}

// ParseLookupBookingsInput — the identity comes from the ticket
// server-side; a raw messengerId in the body would let anyone enumerate
// another guest's bookings, so none is accepted.
func ParseLookupBookingsInput(body []byte) (contracts.LookupBookingsInput, *Errors) {
	m, e := rawObject(body)
	if e != nil {
		return contracts.LookupBookingsInput{}, e
	}
	e = NewErrors()
	var out contracts.LookupBookingsInput
	out.GuestTicket, _ = strValue(e, m, "guestTicket", true, false, AuthTicketRule)
	return out, e.Finish()
}

// ParseCancelBookingByOrganizerInput — organizer cancels a booking of
// their own service from the cabinet.
func ParseCancelBookingByOrganizerInput(body []byte) (contracts.CancelBookingByOrganizerInput, *Errors) {
	m, e := rawObject(body)
	if e != nil {
		return contracts.CancelBookingByOrganizerInput{}, e
	}
	e = NewErrors()
	var out contracts.CancelBookingByOrganizerInput
	out.BookingID, _ = strValue(e, m, "bookingId", true, false, UUIDRule)
	return out, e.Finish()
}
