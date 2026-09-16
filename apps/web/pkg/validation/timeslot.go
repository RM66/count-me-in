package validation

import (
	"time"

	"countmein/pkg/contracts"
)

// How far into the past a slot start may still be accepted: the browser
// validates against its own clock and the server re-validates a round
// trip later against a different one.
const SlotStartTolerance = 60 * time.Second

const SlotStartInPastMessage = "Pick a time in the future — guests cannot book a session that has already started"

func AcceptableSlotStart(t time.Time) bool {
	return t.After(time.Now().Add(-SlotStartTolerance))
}

// ParseCreateTimeSlotInput — a slot in the past would be written and
// immediately invisible (nobody can book it), so it is rejected here.
func ParseCreateTimeSlotInput(body []byte) (contracts.CreateTimeSlotInput, *Errors) {
	m, e := rawObject(body)
	if e != nil {
		return contracts.CreateTimeSlotInput{}, e
	}
	e = NewErrors()
	var out contracts.CreateTimeSlotInput

	out.ServiceID, _ = strValue(e, m, "serviceId", true, false, ServiceIDRule)
	startsAt, _ := flexTimeValue(e, m, "startsAt", true, func(ft contracts.FlexTime) string {
		if !AcceptableSlotStart(ft.Time()) {
			return SlotStartInPastMessage
		}
		return ""
	})
	out.StartsAt = startsAt.Time()
	duration, _ := intValue(e, m, "durationMinutes", true, intRange(1, 1440))
	out.DurationMinutes = int(duration)
	capacity, _ := intValue(e, m, "capacity", true, intRange(1, 100_000))
	out.Capacity = int(capacity)
	if v, present := strValue(e, m, "price", false, true, PriceRule); present {
		out.Price = &v
	}
	return out, e.Finish()
}

// ParseUpdateTimeSlotInput — slot edits; a slot cannot be moved to a
// different service (serviceId is not accepted at all).
func ParseUpdateTimeSlotInput(body []byte) (contracts.UpdateTimeSlotInput, *Errors) {
	m, e := rawObject(body)
	if e != nil {
		return contracts.UpdateTimeSlotInput{}, e
	}
	e = NewErrors()
	var out contracts.UpdateTimeSlotInput

	out.StartsAt = optFlexTime(e, m, "startsAt", false, func(ft contracts.FlexTime) string {
		if !AcceptableSlotStart(ft.Time()) {
			return SlotStartInPastMessage
		}
		return ""
	})
	out.DurationMinutes = optInt(e, m, "durationMinutes", false, intRange(1, 1440))
	out.Capacity = optInt(e, m, "capacity", false, intRange(1, 100_000))
	out.Price = optStr(e, m, "price", true, true, PriceRule)
	return out, e.Finish()
}
