package contracts

// Hand-written request plumbing: not a wire type (see wire.ts A.3).
// Carries the validated booking input plus the resolved guest identity into
// the booking transaction.
type CreateBookingData struct {
	ServiceID       string
	TimeSlotID      string
	Seats           int
	GuestName       string
	SelectedOptions []string
	GuestLocale     string
	Guest           AuthTicketPayload
}
