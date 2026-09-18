// Generated from packages/contracts via scripts/generate-contracts.ts. Contains only derived code; hand-written rules live in rules.go / refine.go / domain.go.
package validation

import (
	"encoding/json"
	"regexp"

	"countmein/pkg/contracts"
)

// ── Patterns & reserved slugs ───────────────────────────────────────────────

var slugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
var serviceIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{6,32}$`)

var reservedSlugs = map[string]bool{
	"api":     true,
	"booking": true,
	"cabinet": true,
	"signup":  true,
	"login":   true,
	"terms":   true,
	"privacy": true,
	"demo":    true,
}

// ── Derived length / int-range rules ────────────────────────────────────────

func DisplayNameRule(v string) string {
	if charLen(v) < 1 || charLen(v) > 100 {
		return "String must contain between 1 and 100 characters"
	}
	return ""
}

func PriceTextRule(v string) string {
	if charLen(v) < 1 || charLen(v) > 50 {
		return "String must contain between 1 and 50 characters"
	}
	return ""
}

func OrganizerDescriptionRule(v string) string {
	if charLen(v) > 4000 {
		return "String must contain at most 4000 characters"
	}
	return ""
}

func ServiceDescriptionRule(v string) string {
	if charLen(v) > 2000 {
		return "String must contain at most 2000 characters"
	}
	return ""
}

func LocationRule(v string) string {
	if charLen(v) < 1 || charLen(v) > 300 {
		return "String must contain between 1 and 300 characters"
	}
	return ""
}

func ContactRule(v string) string {
	if charLen(v) < 1 || charLen(v) > 300 {
		return "String must contain between 1 and 300 characters"
	}
	return ""
}

func OptionLabelRule(v string) string {
	if charLen(v) < 1 || charLen(v) > 100 {
		return "String must contain between 1 and 100 characters"
	}
	return ""
}

func ManageTokenRule(v string) string {
	if charLen(v) < 10 || charLen(v) > 200 {
		return "String must contain between 10 and 200 characters"
	}
	return ""
}

func MessengerIDRule(v string) string {
	if charLen(v) < 1 || charLen(v) > 100 {
		return "String must contain between 1 and 100 characters"
	}
	return ""
}

func AuthTicketRule(v string) string {
	if charLen(v) < 20 || charLen(v) > 200 {
		return "String must contain between 20 and 200 characters"
	}
	return ""
}

// Pre-allocated range rules to eliminate per-request closure heap allocations.
var (
	seatsRangeRule                  = intRange(1, 1000)
	capacityRangeRule               = intRange(1, 100000)
	durationMinutesRangeRule        = intRange(1, 1440)
	maxSeatsPerBookingRangeRule     = intRange(1, 1000)
	avatarUploadSizeRangeRule       = intRange(1, 1048576)
	servicePhotoUploadSizeRangeRule = intRange(1, 2097152)
)

// ── Derived enum rules (A.2 order) ──────────────────────────────────────────

func OptionsSelectModeRule(v string) string {
	switch v {
	case "single", "multi":
		return ""
	}
	return "Invalid input: expected one of single|multi"
}

func AppLocaleRule(v string) string {
	switch v {
	case "en", "de", "es", "fr", "pt", "ru", "ar", "ja":
		return ""
	}
	return "Invalid input: expected one of en|de|es|fr|pt|ru|ar|ja"
}

func ImageContentTypeRule(v string) string {
	switch v {
	case "image/jpeg", "image/png", "image/webp":
		return ""
	}
	return "Invalid input: expected one of image/jpeg|image/png|image/webp"
}

// ── Parsers ─────────────────────────────────────────────────────────────────

// ParseCreateBookingInput — port of createBookingInput.
func ParseCreateBookingInput(body []byte) (contracts.CreateBookingInput, *Errors) {
	m, e := rawObject(body)
	if e != nil {
		return contracts.CreateBookingInput{}, e
	}
	e = NewErrors()
	var out contracts.CreateBookingInput

	out.ServiceID, _ = strValue(e, m, "serviceId", true, false, ServiceIDRule)
	out.TimeSlotID, _ = strValue(e, m, "timeSlotId", true, false, UUIDRule)
	seats, _ := intValue(e, m, "seats", true, seatsRangeRule)
	out.Seats = int(seats)
	out.GuestName, _ = strValue(e, m, "guestName", true, true, DisplayNameRule)
	out.GuestTicket, _ = strValue(e, m, "guestTicket", true, false, AuthTicketRule)
	out.SelectedOptions, _ = strArrValue(e, m, "selectedOptions", false, true, OptionLabelRule, 50)
	out.GuestLocale = guestLocaleOrDefault(e, m)

	return out, e.Finish()
}

func guestLocaleOrDefault(e *Errors, m map[string]json.RawMessage) string {
	guestLocale, _ := strValue(e, m, "guestLocale", false, false, AppLocaleRule)
	if guestLocale == "" {
		return "en"
	}
	return guestLocale
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

// ParseLookupBookingsInput — port of lookupBookingsInput.
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

// ParseCancelBookingByOrganizerInput — port of cancelBookingByOrganizerInput.
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

// ParseCreateServiceInput — port of createServiceInput.
func ParseCreateServiceInput(body []byte) (contracts.CreateServiceInput, *Errors) {
	m, e := rawObject(body)
	if e != nil {
		return contracts.CreateServiceInput{}, e
	}
	e = NewErrors()
	var out contracts.CreateServiceInput

	out.Title, _ = strValue(e, m, "title", true, true, DisplayNameRule)
	description, descriptionPresent := strValue(e, m, "description", false, true, ServiceDescriptionRule)
	if descriptionPresent {
		out.Description = &description
	}
	location, locationPresent := strValue(e, m, "location", false, true, LocationRule)
	if locationPresent {
		out.Location = &location
	}
	contact, contactPresent := strValue(e, m, "contact", false, true, ContactRule)
	if contactPresent {
		out.Contact = &contact
	}
	out.DefaultPrice, _ = strValue(e, m, "defaultPrice", true, true, PriceTextRule)
	defaultCapacity, _ := intValue(e, m, "defaultCapacity", true, capacityRangeRule)
	out.DefaultCapacity = int(defaultCapacity)
	defaultDurationMinutes, _ := intValue(e, m, "defaultDurationMinutes", true, durationMinutesRangeRule)
	out.DefaultDurationMinutes = int(defaultDurationMinutes)
	maxSeatsPerBooking, _ := intValue(e, m, "maxSeatsPerBooking", true, maxSeatsPerBookingRangeRule)
	out.MaxSeatsPerBooking = int(maxSeatsPerBooking)
	out.Options, _ = strArrValue(e, m, "options", false, true, OptionLabelRule, 50)
	optionsSelectMode, _ := strValue(e, m, "optionsSelectMode", false, false, OptionsSelectModeRule)
	if optionsSelectMode != "" {
		optionsSelectModeTyped := contracts.OptionsSelectMode(optionsSelectMode)
		out.OptionsSelectMode = &optionsSelectModeTyped
	}
	photoUrl, photoUrlPresent := strValue(e, m, "photoUrl", false, false, URLRule)
	if photoUrlPresent {
		out.PhotoURL = &photoUrl
	}

	refineCreateServiceInput(e, &out)
	return out, e.Finish()
}

// ParseUpdateServiceInput — port of updateServiceInput.
func ParseUpdateServiceInput(body []byte) (contracts.UpdateServiceInput, *Errors) {
	m, e := rawObject(body)
	if e != nil {
		return contracts.UpdateServiceInput{}, e
	}
	e = NewErrors()
	var out contracts.UpdateServiceInput

	out.Title = optStr(e, m, "title", true, false, DisplayNameRule)
	out.Description = optStr(e, m, "description", true, true, ServiceDescriptionRule)
	out.Location = optStr(e, m, "location", true, true, LocationRule)
	out.Contact = optStr(e, m, "contact", true, true, ContactRule)
	out.DefaultPrice = optStr(e, m, "defaultPrice", true, false, PriceTextRule)
	out.DefaultCapacity = optInt(e, m, "defaultCapacity", false, capacityRangeRule)
	out.DefaultDurationMinutes = optInt(e, m, "defaultDurationMinutes", false, durationMinutesRangeRule)
	out.MaxSeatsPerBooking = optInt(e, m, "maxSeatsPerBooking", false, maxSeatsPerBookingRangeRule)
	out.Options = optStrArr(e, m, "options", true, OptionLabelRule, 50)
	optionsSelectMode := optStr(e, m, "optionsSelectMode", false, true, OptionsSelectModeRule)
	if optionsSelectMode.Set {
		out.OptionsSelectMode.Set = true
		if optionsSelectMode.Value != nil {
			optionsSelectModeTyped := contracts.OptionsSelectMode(*optionsSelectMode.Value)
			out.OptionsSelectMode.Value = &optionsSelectModeTyped
		}
	}
	out.PhotoURL = optStr(e, m, "photoUrl", false, true, URLRule)

	refineUpdateServiceInput(e, &out)
	return out, e.Finish()
}

// ParseCreateTimeSlotInput — port of createTimeSlotInput.
func ParseCreateTimeSlotInput(body []byte) (contracts.CreateTimeSlotInput, *Errors) {
	m, e := rawObject(body)
	if e != nil {
		return contracts.CreateTimeSlotInput{}, e
	}
	e = NewErrors()
	var out contracts.CreateTimeSlotInput

	out.ServiceID, _ = strValue(e, m, "serviceId", true, false, ServiceIDRule)
	startsAt, startsAtPresent := flexTimeValue(e, m, "startsAt", true, nil)
	if startsAtPresent {
		out.StartsAt = startsAt.Time()
	}
	durationMinutes, _ := intValue(e, m, "durationMinutes", true, durationMinutesRangeRule)
	out.DurationMinutes = int(durationMinutes)
	capacity, _ := intValue(e, m, "capacity", true, capacityRangeRule)
	out.Capacity = int(capacity)
	price, pricePresent := strValue(e, m, "price", false, true, PriceTextRule)
	if pricePresent {
		out.Price = &price
	}

	refineCreateTimeSlotInput(e, &out)
	return out, e.Finish()
}

// ParseUpdateTimeSlotInput — port of updateTimeSlotInput.
func ParseUpdateTimeSlotInput(body []byte) (contracts.UpdateTimeSlotInput, *Errors) {
	m, e := rawObject(body)
	if e != nil {
		return contracts.UpdateTimeSlotInput{}, e
	}
	e = NewErrors()
	var out contracts.UpdateTimeSlotInput

	out.StartsAt = optFlexTime(e, m, "startsAt", false, nil)
	out.DurationMinutes = optInt(e, m, "durationMinutes", false, durationMinutesRangeRule)
	out.Capacity = optInt(e, m, "capacity", false, capacityRangeRule)
	out.Price = optStr(e, m, "price", true, true, PriceTextRule)

	refineUpdateTimeSlotInput(e, &out)
	return out, e.Finish()
}

// ParseRegisterOrganizerInput — port of registerOrganizerInput.
func ParseRegisterOrganizerInput(body []byte) (contracts.RegisterOrganizerInput, *Errors) {
	m, e := rawObject(body)
	if e != nil {
		return contracts.RegisterOrganizerInput{}, e
	}
	e = NewErrors()
	var out contracts.RegisterOrganizerInput

	out.Ticket, _ = strValue(e, m, "ticket", true, false, AuthTicketRule)
	out.Slug, _ = strValue(e, m, "slug", true, true, SlugRule)
	out.Name, _ = strValue(e, m, "name", true, true, DisplayNameRule)
	out.Timezone, _ = strValue(e, m, "timezone", true, false, TimezoneRule)
	contact, contactPresent := strValue(e, m, "contact", false, true, ContactRule)
	if contactPresent {
		out.Contact = &contact
	}
	out.Language = languageOrDefault(e, m)

	refineRegisterOrganizerInput(e, &out)
	return out, e.Finish()
}

func languageOrDefault(e *Errors, m map[string]json.RawMessage) string {
	language, _ := strValue(e, m, "language", false, false, AppLocaleRule)
	if language == "" {
		return "en"
	}
	return language
}

// ParseUpdateOrganizerProfileInput — port of updateOrganizerProfileInput.
func ParseUpdateOrganizerProfileInput(body []byte) (contracts.UpdateOrganizerProfileInput, *Errors) {
	m, e := rawObject(body)
	if e != nil {
		return contracts.UpdateOrganizerProfileInput{}, e
	}
	e = NewErrors()
	var out contracts.UpdateOrganizerProfileInput

	out.Name = optStr(e, m, "name", true, false, DisplayNameRule)
	out.Slug = optStr(e, m, "slug", true, false, SlugRule)
	out.Timezone = optStr(e, m, "timezone", false, false, TimezoneRule)
	out.Description = optStr(e, m, "description", true, true, OrganizerDescriptionRule)
	out.Location = optStr(e, m, "location", true, true, LocationRule)
	out.Contact = optStr(e, m, "contact", true, true, ContactRule)
	out.PhotoURL = optStr(e, m, "photoUrl", false, true, URLRule)

	refineUpdateOrganizerProfileInput(e, &out)
	return out, e.Finish()
}

// ParseUpdateOrganizerLanguageInput — port of updateOrganizerLanguageInput.
func ParseUpdateOrganizerLanguageInput(body []byte) (contracts.UpdateOrganizerLanguageInput, *Errors) {
	m, e := rawObject(body)
	if e != nil {
		return contracts.UpdateOrganizerLanguageInput{}, e
	}
	e = NewErrors()
	var out contracts.UpdateOrganizerLanguageInput

	out.Language, _ = strValue(e, m, "language", true, false, AppLocaleRule)

	return out, e.Finish()
}

// ParseCreateAvatarUploadInput — port of createAvatarUploadInput.
func ParseCreateAvatarUploadInput(body []byte) (contracts.CreateAvatarUploadInput, *Errors) {
	m, e := rawObject(body)
	if e != nil {
		return contracts.CreateAvatarUploadInput{}, e
	}
	e = NewErrors()
	var out contracts.CreateAvatarUploadInput

	out.ContentType, _ = strValue(e, m, "contentType", true, false, ImageContentTypeRule)
	size, _ := intValue(e, m, "size", true, avatarUploadSizeRangeRule)
	out.Size = int(size)

	return out, e.Finish()
}

// ParseCreateServicePhotoUploadInput — port of createServicePhotoUploadInput.
func ParseCreateServicePhotoUploadInput(body []byte) (contracts.CreateServicePhotoUploadInput, *Errors) {
	m, e := rawObject(body)
	if e != nil {
		return contracts.CreateServicePhotoUploadInput{}, e
	}
	e = NewErrors()
	var out contracts.CreateServicePhotoUploadInput

	out.ContentType, _ = strValue(e, m, "contentType", true, false, ImageContentTypeRule)
	size, _ := intValue(e, m, "size", true, servicePhotoUploadSizeRangeRule)
	out.Size = int(size)

	return out, e.Finish()
}

var Parsers = map[string]func([]byte) (any, *Errors){
	"CreateBookingInput":            func(b []byte) (any, *Errors) { return ParseCreateBookingInput(b) },
	"CancelBookingByTokenInput":     func(b []byte) (any, *Errors) { return ParseCancelBookingByTokenInput(b) },
	"LookupBookingsInput":           func(b []byte) (any, *Errors) { return ParseLookupBookingsInput(b) },
	"CancelBookingByOrganizerInput": func(b []byte) (any, *Errors) { return ParseCancelBookingByOrganizerInput(b) },
	"CreateServiceInput":            func(b []byte) (any, *Errors) { return ParseCreateServiceInput(b) },
	"UpdateServiceInput":            func(b []byte) (any, *Errors) { return ParseUpdateServiceInput(b) },
	"CreateTimeSlotInput":           func(b []byte) (any, *Errors) { return ParseCreateTimeSlotInput(b) },
	"UpdateTimeSlotInput":           func(b []byte) (any, *Errors) { return ParseUpdateTimeSlotInput(b) },
	"RegisterOrganizerInput":        func(b []byte) (any, *Errors) { return ParseRegisterOrganizerInput(b) },
	"UpdateOrganizerProfileInput":   func(b []byte) (any, *Errors) { return ParseUpdateOrganizerProfileInput(b) },
	"UpdateOrganizerLanguageInput":  func(b []byte) (any, *Errors) { return ParseUpdateOrganizerLanguageInput(b) },
	"CreateAvatarUploadInput":       func(b []byte) (any, *Errors) { return ParseCreateAvatarUploadInput(b) },
	"CreateServicePhotoUploadInput": func(b []byte) (any, *Errors) { return ParseCreateServicePhotoUploadInput(b) },
}
