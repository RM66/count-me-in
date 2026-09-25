package validation

import (
	"encoding/json"

	gen "countmein/pkg/api/gen"
)

// Decode functions (ADR-016, Phase 3): ordinary hand-written code, one per
// wire input. Each applies the Zod transforms the spec cannot express
// (trim, slug lowercasing), validates the body against the component schema
// via kin-openapi (spec.go), unmarshals into the oapi-codegen struct, then
// runs the hand-written refinements (refine.go). They replace the fourteen
// generated Parse* parsers; parity is pinned by
// packages/contracts/vectors/validation/*.

// decode is the shared skeleton: validate m against schemaName, unmarshal
// into out, return nil when valid.
func decode(schemaName string, m map[string]json.RawMessage, out any) *Errors {
	if errs := validateBody(schemaName, m); errs != nil {
		return errs
	}
	body, err := json.Marshal(m)
	if err != nil {
		return FormErrors("Invalid JSON")
	}
	if err := json.Unmarshal(body, out); err != nil {
		return FormErrors("Invalid JSON")
	}
	return nil
}

// decodeCollect is decode for the inputs that must report spec errors and
// refinement errors together: it returns the collected field errors even
// when the body also fails struct unmarshaling (a bad options array still
// yields the optionsSelectMode consistency message). With no spec errors a
// failed unmarshal degrades to a generic form error, like decode.
//
// Invariant: unlike decode, the returned *Errors may be non-nil yet empty
// (spec validation passed, unmarshal succeeded) — callers must funnel it
// through refinements and return e.Finish(), which is what turns an empty
// Errors into nil. Never return the result of decodeCollect directly.
func decodeCollect(schemaName string, m map[string]json.RawMessage, out any) *Errors {
	e := validateBody(schemaName, m)
	if e == nil {
		e = NewErrors()
	}
	body, err := json.Marshal(m)
	if err != nil {
		return FormErrors("Invalid JSON")
	}
	if err := json.Unmarshal(body, out); err != nil {
		if e.Empty() {
			return FormErrors("Invalid JSON")
		}
		return e
	}
	return e
}

// ── Bookings ─────────────────────────────────────────────────────────────────

func DecodeCreateBookingInput(body []byte) (gen.CreateBookingInput, *Errors) {
	var out gen.CreateBookingInput
	m, e := rawObject(body)
	if e != nil {
		return out, e
	}
	trimJSONKey(m, "guestName")
	trimJSONKey(m, "selectedOptions")
	if errs := decode("CreateBookingInput", m, &out); errs != nil {
		return out, errs
	}
	if out.GuestLocale == nil {
		locale := gen.En
		out.GuestLocale = &locale
	}
	return out, nil
}

func DecodeCancelBookingByTokenInput(body []byte) (gen.CancelBookingByTokenInput, *Errors) {
	var out gen.CancelBookingByTokenInput
	m, e := rawObject(body)
	if e != nil {
		return out, e
	}
	return out, decode("CancelBookingByTokenInput", m, &out)
}

func DecodeLookupBookingsInput(body []byte) (gen.LookupBookingsInput, *Errors) {
	var out gen.LookupBookingsInput
	m, e := rawObject(body)
	if e != nil {
		return out, e
	}
	return out, decode("LookupBookingsInput", m, &out)
}

func DecodeCancelBookingByOrganizerInput(body []byte) (gen.CancelBookingByOrganizerInput, *Errors) {
	var out gen.CancelBookingByOrganizerInput
	m, e := rawObject(body)
	if e != nil {
		return out, e
	}
	return out, decode("CancelBookingByOrganizerInput", m, &out)
}

// ── Services ────────────────────────────────────────────────────────────────

func DecodeCreateServiceInput(body []byte) (gen.CreateServiceInput, *Errors) {
	var out gen.CreateServiceInput
	m, e := rawObject(body)
	if e != nil {
		return out, e
	}
	trimServiceKeys(m)
	e = decodeCollect("CreateServiceInput", m, &out)
	if out.PhotoURL != nil {
		if msg := URLRule(string(*out.PhotoURL)); msg != "" {
			e.Add("photoUrl", msg)
		}
	}
	refineServiceOptions(e, out.Options, out.OptionsSelectMode)
	return out, e.Finish()
}

// DecodeUpdateServiceInput validates a merge-patch document against the
// update schema, including the options/mode pair check on the patch
// itself (parity with the Zod superRefine, which sees only the patch).
// A patch touching only one side of the pair is rejected here and must
// send both — the handler additionally validates the merged state
// (RefineServiceMergedState), so the final entity is checked twice.
func DecodeUpdateServiceInput(body []byte) (gen.UpdateServiceInput, *Errors) {
	var out gen.UpdateServiceInput
	m, e := rawObject(body)
	if e != nil {
		return out, e
	}
	trimServiceKeys(m)
	e = decodeCollect("UpdateServiceInput", m, &out)
	if out.PhotoURL != nil {
		if msg := URLRule(string(*out.PhotoURL)); msg != "" {
			e.Add("photoUrl", msg)
		}
	}
	refineServiceOptions(e, out.Options, out.OptionsSelectMode)
	return out, e.Finish()
}

func trimServiceKeys(m map[string]json.RawMessage) {
	for _, key := range []string{"title", "description", "location", "contact", "defaultPrice", "options"} {
		trimJSONKey(m, key)
	}
}

// ── Time slots ───────────────────────────────────────────────────────────────

func DecodeCreateTimeSlotInput(body []byte) (gen.CreateTimeSlotInput, *Errors) {
	var out gen.CreateTimeSlotInput
	m, e := rawObject(body)
	if e != nil {
		return out, e
	}
	trimJSONKey(m, "price")
	if errs := decode("CreateTimeSlotInput", m, &out); errs != nil {
		return out, errs
	}
	e = NewErrors()
	refineSlotStart(e, out.StartsAt)
	return out, e.Finish()
}

func DecodeUpdateTimeSlotInput(body []byte) (gen.UpdateTimeSlotInput, *Errors) {
	var out gen.UpdateTimeSlotInput
	m, e := rawObject(body)
	if e != nil {
		return out, e
	}
	trimJSONKey(m, "price")
	if errs := decode("UpdateTimeSlotInput", m, &out); errs != nil {
		return out, errs
	}
	e = NewErrors()
	if out.StartsAt != nil {
		refineSlotStart(e, *out.StartsAt)
	}
	return out, e.Finish()
}

// ── Organizers ───────────────────────────────────────────────────────────────

func DecodeRegisterOrganizerInput(body []byte) (gen.RegisterOrganizerInput, *Errors) {
	var out gen.RegisterOrganizerInput
	m, e := rawObject(body)
	if e != nil {
		return out, e
	}
	trimJSONKey(m, "slug")
	lowerJSONKey(m, "slug")
	trimJSONKey(m, "name")
	trimJSONKey(m, "contact")
	if errs := decode("RegisterOrganizerInput", m, &out); errs != nil {
		return out, errs
	}
	if out.Language == nil {
		locale := gen.En
		out.Language = &locale
	}
	e = NewErrors()
	if msg := TimezoneRule(string(out.Timezone)); msg != "" {
		e.Add("timezone", msg)
	}
	if IsReservedSlug(string(out.Slug)) {
		e.Add("slug", "this slug is reserved for system use — please choose another")
	}
	return out, e.Finish()
}

func DecodeUpdateOrganizerProfileInput(body []byte) (gen.UpdateOrganizerProfileInput, *Errors) {
	var out gen.UpdateOrganizerProfileInput
	m, e := rawObject(body)
	if e != nil {
		return out, e
	}
	trimJSONKey(m, "slug")
	lowerJSONKey(m, "slug")
	for _, key := range []string{"name", "description", "location", "contact"} {
		trimJSONKey(m, key)
	}
	if errs := decode("UpdateOrganizerProfileInput", m, &out); errs != nil {
		return out, errs
	}
	e = NewErrors()
	if out.Timezone != nil {
		if msg := TimezoneRule(string(*out.Timezone)); msg != "" {
			e.Add("timezone", msg)
		}
	}
	if out.Slug != nil && IsReservedSlug(string(*out.Slug)) {
		e.Add("slug", "this slug is reserved for system use — please choose another")
	}
	if out.PhotoURL != nil {
		if msg := URLRule(string(*out.PhotoURL)); msg != "" {
			e.Add("photoUrl", msg)
		}
	}
	return out, e.Finish()
}

func DecodeUpdateOrganizerLanguageInput(body []byte) (gen.UpdateOrganizerLanguageInput, *Errors) {
	var out gen.UpdateOrganizerLanguageInput
	m, e := rawObject(body)
	if e != nil {
		return out, e
	}
	return out, decode("UpdateOrganizerLanguageInput", m, &out)
}

func DecodeCreateAvatarUploadInput(body []byte) (gen.CreateAvatarUploadInput, *Errors) {
	var out gen.CreateAvatarUploadInput
	m, e := rawObject(body)
	if e != nil {
		return out, e
	}
	return out, decode("CreateAvatarUploadInput", m, &out)
}

func DecodeCreateServicePhotoUploadInput(body []byte) (gen.CreateServicePhotoUploadInput, *Errors) {
	var out gen.CreateServicePhotoUploadInput
	m, e := rawObject(body)
	if e != nil {
		return out, e
	}
	return out, decode("CreateServicePhotoUploadInput", m, &out)
}

// ── Telegram widget ──────────────────────────────────────────────────────────

func DecodeTelegramWidgetPayload(body []byte) (gen.TelegramWidgetPayload, *Errors) {
	var out gen.TelegramWidgetPayload
	m, e := rawObject(body)
	if e != nil {
		return out, e
	}
	if errs := decode("TelegramWidgetPayload", m, &out); errs != nil {
		return out, errs
	}
	e = NewErrors()
	if out.PhotoURL != nil {
		if msg := URLRule(string(*out.PhotoURL)); msg != "" {
			e.Add("photo_url", msg)
		}
	}
	return out, e.Finish()
}

// ── Merge-patch merged-state decoders (ADR-016, Phase 4) ───────────────────
//
// The three partial-update endpoints validate the *merged* state
// (current + patch, RFC 7386), not the patch alone: bounds apply to the
// final state, and cross-field rules (options/mode consistency) see the
// whole entity. The patch itself is still validated first by the
// ordinary Decode* functions, so a null on a non-nullable key is
// rejected before the merge ever runs.
//
// Note on the generated structs: Update inputs are all-pointer structs
// where absent and null both decode to nil — patchKeys (the Touched set)
// is what distinguishes them for the UPDATE. The mixed `omitempty` tags
// oapi-codegen emits for nullable vs non-nullable optionals only affect
// marshaling, which these decoders never do for requests.

// DecodeMergedServiceInput validates a merged service state against the
// update schema and the merged-state refinements.
func DecodeMergedServiceInput(merged []byte) (gen.UpdateServiceInput, *Errors) {
	var out gen.UpdateServiceInput
	m, e := rawObject(merged)
	if e != nil {
		return out, e
	}
	trimServiceKeys(m)
	e = decodeCollect("UpdateServiceInput", m, &out)
	if out.PhotoURL != nil {
		if msg := URLRule(string(*out.PhotoURL)); msg != "" {
			e.Add("photoUrl", msg)
		}
	}
	RefineServiceMergedState(e, &out)
	return out, e.Finish()
}

// DecodeMergedOrganizerInput validates a merged organizer profile state.
func DecodeMergedOrganizerInput(merged []byte) (gen.UpdateOrganizerProfileInput, *Errors) {
	var out gen.UpdateOrganizerProfileInput
	m, e := rawObject(merged)
	if e != nil {
		return out, e
	}
	trimJSONKey(m, "slug")
	lowerJSONKey(m, "slug")
	for _, key := range []string{"name", "description", "location", "contact"} {
		trimJSONKey(m, key)
	}
	if errs := decode("UpdateOrganizerProfileInput", m, &out); errs != nil {
		return out, errs
	}
	e = NewErrors()
	RefineOrganizerMergedState(e, &out)
	if out.Timezone != nil {
		if msg := TimezoneRule(string(*out.Timezone)); msg != "" {
			e.Add("timezone", msg)
		}
	}
	if out.Slug != nil && IsReservedSlug(string(*out.Slug)) {
		e.Add("slug", "this slug is reserved for system use — please choose another")
	}
	if out.PhotoURL != nil {
		if msg := URLRule(string(*out.PhotoURL)); msg != "" {
			e.Add("photoUrl", msg)
		}
	}
	return out, e.Finish()
}

// DecodeMergedSlotInput validates a merged slot state; startsAt is only
// checked against the past when the patch touched it (the merged state
// always carries the current value, which may legitimately be past).
func DecodeMergedSlotInput(merged []byte, startsAtTouched bool) (gen.UpdateTimeSlotInput, *Errors) {
	var out gen.UpdateTimeSlotInput
	m, e := rawObject(merged)
	if e != nil {
		return out, e
	}
	trimJSONKey(m, "price")
	if errs := decode("UpdateTimeSlotInput", m, &out); errs != nil {
		return out, errs
	}
	e = NewErrors()
	RefineSlotMergedState(e, &out, startsAtTouched)
	return out, e.Finish()
}

// ── Vectors dispatch ─────────────────────────────────────────────────────────
//
// Schema dispatch for the parity vectors — a new input works in the vectors
// with no test edit: add its Decode* here under its wire id.

var Decoders = map[string]func([]byte) (any, *Errors){
	"CreateBookingInput":            func(b []byte) (any, *Errors) { return DecodeCreateBookingInput(b) },
	"CancelBookingByTokenInput":     func(b []byte) (any, *Errors) { return DecodeCancelBookingByTokenInput(b) },
	"LookupBookingsInput":           func(b []byte) (any, *Errors) { return DecodeLookupBookingsInput(b) },
	"CancelBookingByOrganizerInput": func(b []byte) (any, *Errors) { return DecodeCancelBookingByOrganizerInput(b) },
	"CreateServiceInput":            func(b []byte) (any, *Errors) { return DecodeCreateServiceInput(b) },
	"UpdateServiceInput":            func(b []byte) (any, *Errors) { return DecodeUpdateServiceInput(b) },
	"CreateTimeSlotInput":           func(b []byte) (any, *Errors) { return DecodeCreateTimeSlotInput(b) },
	"UpdateTimeSlotInput":           func(b []byte) (any, *Errors) { return DecodeUpdateTimeSlotInput(b) },
	"RegisterOrganizerInput":        func(b []byte) (any, *Errors) { return DecodeRegisterOrganizerInput(b) },
	"UpdateOrganizerProfileInput":   func(b []byte) (any, *Errors) { return DecodeUpdateOrganizerProfileInput(b) },
	"UpdateOrganizerLanguageInput":  func(b []byte) (any, *Errors) { return DecodeUpdateOrganizerLanguageInput(b) },
	"CreateAvatarUploadInput":       func(b []byte) (any, *Errors) { return DecodeCreateAvatarUploadInput(b) },
	"CreateServicePhotoUploadInput": func(b []byte) (any, *Errors) { return DecodeCreateServicePhotoUploadInput(b) },
	"TelegramWidgetPayload":         func(b []byte) (any, *Errors) { return DecodeTelegramWidgetPayload(b) },
}
