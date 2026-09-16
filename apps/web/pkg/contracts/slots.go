package contracts

// Slot capacity and price rules — isomorphic in the TS code (public page,
// cabinet, notification worker must agree), mirrored here.

// SeatsLeft is remaining seats, floored at zero.
func SeatsLeft(capacity, bookedCount int) int {
	if left := capacity - bookedCount; left > 0 {
		return left
	}
	return 0
}

// SlotPrice is a slot's own price override, else the service default
// (non-nullable column), else "" (display text only — no payments in
// MVP).
func SlotPrice(slotPrice *string, serviceDefaultPrice string) string {
	if slotPrice != nil {
		return *slotPrice
	}
	return serviceDefaultPrice
}

// EffectiveLocation — a service may override its organizer's location.
func EffectiveLocation(service, organizer *string) *string {
	if service != nil {
		return service
	}
	return organizer
}

// EffectiveContact — same inheritance rule as location.
func EffectiveContact(service, organizer *string) *string {
	if service != nil {
		return service
	}
	return organizer
}
