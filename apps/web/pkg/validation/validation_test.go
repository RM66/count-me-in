package validation

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	gen "countmein/pkg/api/gen"
	"countmein/pkg/contracts"
)

const (
	validServiceID = "demo-yoga"
	validSlotID    = "01930000-0000-7000-8000-0000000a0001"
)

func TestDecodeCreateBookingInputValid(t *testing.T) {
	body := `{"serviceId":"` + validServiceID + `","timeSlotId":"` + validSlotID +
		`","seats":2,"guestName":"Mila Petrović","guestTicket":"whatever-guest-ticket-12345678",` +
		`"selectedOptions":["Riverside studio"],"guestLocale":"ru"}`
	out, errs := DecodeCreateBookingInput([]byte(body))
	if errs != nil {
		t.Fatalf("valid body must parse: %+v", errs)
	}
	if out.ServiceID != validServiceID || contracts.UUIDString(out.TimeSlotID) != validSlotID || out.Seats != 2 ||
		out.GuestName != "Mila Petrović" || string(*out.GuestLocale) != "ru" ||
		len(*out.SelectedOptions) != 1 || (*out.SelectedOptions)[0] != "Riverside studio" {
		t.Fatalf("unexpected output: %+v", out)
	}
}

func TestDecodeCreateBookingInputDefaultsAndErrors(t *testing.T) {
	// guestLocale absent → default en.
	out, errs := DecodeCreateBookingInput([]byte(`{
		"serviceId":"` + validServiceID + `", "timeSlotId":"` + validSlotID + `",
		"seats":1, "guestName":"Noah", "guestTicket":"whatever-guest-ticket-12345678"}`))
	if errs != nil {
		t.Fatalf("minimal valid body must parse: %+v", errs)
	}
	if string(*out.GuestLocale) != contracts.DefaultLocale {
		t.Fatalf("guestLocale must default to en, got %v", out.GuestLocale)
	}
	if out.SelectedOptions != nil {
		t.Fatalf("selectedOptions absent → nil, got %v", out.SelectedOptions)
	}

	// Missing seats + bad types.
	_, errs = DecodeCreateBookingInput([]byte(`{"serviceId":"` + validServiceID + `","timeSlotId":"` + validSlotID + `","guestName":"Noah","guestTicket":"whatever-guest-ticket-12345678"}`))
	if errs == nil || len(errs.Fields["seats"]) == 0 {
		t.Fatalf("missing seats must be a field error, got %+v", errs)
	}
	_, errs = DecodeCreateBookingInput([]byte(`{"serviceId":123,"timeSlotId":"` + validSlotID + `","seats":1,"guestName":"Noah","guestTicket":"whatever-guest-ticket-12345678"}`))
	if errs == nil || len(errs.Fields["serviceId"]) == 0 {
		t.Fatalf("serviceId number must be a field error, got %+v", errs)
	}
	// seats float.
	_, errs = DecodeCreateBookingInput([]byte(`{"serviceId":"` + validServiceID + `","timeSlotId":"` + validSlotID + `","seats":1.5,"guestName":"Noah","guestTicket":"whatever-guest-ticket-12345678"}`))
	if errs == nil || len(errs.Fields["seats"]) == 0 {
		t.Fatalf("fractional seats must be a field error, got %+v", errs)
	}
	// selectedOptions null → invalid (optional, not nullable).
	_, errs = DecodeCreateBookingInput([]byte(`{"serviceId":"` + validServiceID + `","timeSlotId":"` + validSlotID + `","seats":1,"guestName":"Noah","guestTicket":"whatever-guest-ticket-12345678","selectedOptions":null}`))
	if errs == nil || len(errs.Fields["selectedOptions"]) == 0 {
		t.Fatalf("selectedOptions null must be a field error, got %+v", errs)
	}
	// bad timeSlotId → the spec's uuid pattern must reject it.
	_, errs = DecodeCreateBookingInput([]byte(`{"serviceId":"` + validServiceID + `","timeSlotId":"not-a-uuid","seats":1,"guestName":"Noah","guestTicket":"whatever-guest-ticket-12345678"}`))
	if errs == nil || len(errs.Fields["timeSlotId"]) == 0 {
		t.Fatalf("non-uuid timeSlotId must be a field error, got %+v", errs)
	}
}

func TestDecodeCreateBookingInputMalformedBodies(t *testing.T) {
	for name, body := range map[string]string{"empty": "", "null": "null", "array": "[]", "garbage": "not json"} {
		_, errs := DecodeCreateBookingInput([]byte(body))
		if errs == nil || len(errs.Form) == 0 {
			t.Errorf("%s: want form error, got %+v", name, errs)
		}
	}
}

func TestDecodeCreateServiceInputOptionsConsistency(t *testing.T) {
	_, errs := DecodeCreateServiceInput([]byte(`{"title":"Yoga","defaultPrice":"10","defaultCapacity":8,"defaultDurationMinutes":60,"maxSeatsPerBooking":2,"options":["A","B"]}`))
	if errs == nil || len(errs.Fields["optionsSelectMode"]) == 0 {
		t.Fatalf("options without mode must fail, got %+v", errs)
	}
	_, errs = DecodeCreateServiceInput([]byte(`{"title":"Yoga","defaultPrice":"10","defaultCapacity":8,"defaultDurationMinutes":60,"maxSeatsPerBooking":2,"optionsSelectMode":"single"}`))
	if errs == nil || len(errs.Fields["optionsSelectMode"]) == 0 {
		t.Fatalf("mode without options must fail, got %+v", errs)
	}
	_, errs = DecodeCreateServiceInput([]byte(`{"title":"Yoga","defaultPrice":"10","defaultCapacity":8,"defaultDurationMinutes":60,"maxSeatsPerBooking":2,"options":["A"],"optionsSelectMode":"single"}`))
	if errs != nil {
		t.Fatalf("options with mode must parse, got %+v", errs)
	}
	_, errs = DecodeCreateServiceInput([]byte(`{"title":"Yoga","defaultPrice":"10","defaultCapacity":8,"defaultDurationMinutes":60,"maxSeatsPerBooking":2,"options":[],"optionsSelectMode":"single"}`))
	if errs == nil || len(errs.Fields["options"]) == 0 {
		t.Fatalf("empty options must fail, got %+v", errs)
	}
	_, errs = DecodeCreateServiceInput([]byte(`{"title":"Yoga","defaultPrice":"10","defaultCapacity":8,"defaultDurationMinutes":60,"maxSeatsPerBooking":2,"options":["A","A"],"optionsSelectMode":"multi"}`))
	if errs == nil || len(errs.Fields["options"]) == 0 {
		t.Fatalf("duplicate options must fail, got %+v", errs)
	}
}

func TestDecodeUpdateServiceInputNonNullableNullRejected(t *testing.T) {
	_, errs := DecodeUpdateServiceInput([]byte(`{"title":null}`))
	if errs == nil || len(errs.Fields["title"]) == 0 {
		t.Fatalf("title null must be a field error, got %+v", errs)
	}
	_, errs = DecodeUpdateServiceInput([]byte(`{"defaultCapacity":null}`))
	if errs == nil || len(errs.Fields["defaultCapacity"]) == 0 {
		t.Fatalf("defaultCapacity null must be a field error, got %+v", errs)
	}
}

// A merge-patch touching only one side of the options/mode pair is
// rejected on the patch itself (parity with the Zod superRefine) —
// the client must send both. The merged state is checked again via
// RefineServiceMergedState.
func TestDecodeUpdateServiceInputPartialOptionsMode(t *testing.T) {
	if _, errs := DecodeUpdateServiceInput([]byte(`{"options":["C"]}`)); errs == nil ||
		len(errs.Fields["optionsSelectMode"]) == 0 {
		t.Fatalf("options-only patch must fail on mode, got %+v", errs)
	}
	if _, errs := DecodeUpdateServiceInput([]byte(`{"optionsSelectMode":"single"}`)); errs == nil ||
		len(errs.Fields["optionsSelectMode"]) == 0 {
		t.Fatalf("mode-only patch must fail, got %+v", errs)
	}
}

func TestDecodeCreateTimeSlotInputPastRejected(t *testing.T) {
	past := time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339)
	_, errs := DecodeCreateTimeSlotInput([]byte(`{"serviceId":"` + validServiceID + `","startsAt":"` + past + `","durationMinutes":60,"capacity":12}`))
	if errs == nil || !strings.Contains(strings.Join(errs.Fields["startsAt"], ";"), "future") {
		t.Fatalf("past slot must fail with the past message, got %+v", errs)
	}

	future := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	out, errs := DecodeCreateTimeSlotInput([]byte(`{"serviceId":"` + validServiceID + `","startsAt":"` + future + `","durationMinutes":60,"capacity":12,"price":"$14"}`))
	if errs != nil {
		t.Fatalf("future slot must parse: %+v", errs)
	}
	if out.Price == nil || *out.Price != "$14" {
		t.Fatalf("price: %+v", out.Price)
	}

	// Date-only strings are rejected by the spec's oneOf.
	_, errs = DecodeCreateTimeSlotInput([]byte(`{"serviceId":"` + validServiceID + `","startsAt":"2026-09-13","durationMinutes":60,"capacity":12}`))
	if errs == nil || len(errs.Fields["startsAt"]) == 0 {
		t.Fatalf("date-only startsAt must be a field error, got %+v", errs)
	}
}

func TestDecodeRegisterOrganizerInputSlugRules(t *testing.T) {
	out, errs := DecodeRegisterOrganizerInput([]byte(`{
		"ticket":"whatever-guest-ticket-12345678","slug":"My-Studio","name":"Studio",
		"timezone":"Europe/Belgrade","contact":"studio@example.com"}`))
	if errs != nil {
		t.Fatalf("valid register body must parse: %+v", errs)
	}
	if string(out.Slug) != "my-studio" {
		t.Fatalf("slug must be lowercased, got %q", out.Slug)
	}
	if out.Language == nil || string(*out.Language) != contracts.DefaultLocale {
		t.Fatalf("language must default to en, got %v", out.Language)
	}

	for name, slug := range map[string]string{
		"reserved":  "demo",
		"reserved2": "api",
		"too short": "abc",
		"bad chars": "my studio",
	} {
		_, errs := DecodeRegisterOrganizerInput([]byte(`{"ticket":"whatever-guest-ticket-12345678","slug":"` + slug + `","name":"Studio","timezone":"Europe/Belgrade"}`))
		if errs == nil || len(errs.Fields["slug"]) == 0 {
			t.Errorf("%s slug %q must be rejected, got %+v", name, slug, errs)
		}
	}

	_, errs = DecodeRegisterOrganizerInput([]byte(`{"ticket":"whatever-guest-ticket-12345678","slug":"my-studio","name":"Studio","timezone":"Not/AZone"}`))
	if errs == nil || len(errs.Fields["timezone"]) == 0 {
		t.Fatalf("bad timezone must be rejected, got %+v", errs)
	}
}

func TestDecodeUpdateOrganizerProfileInput(t *testing.T) {
	out, errs := DecodeUpdateOrganizerProfileInput([]byte(`{"name":"Studio Two","photoUrl":null}`))
	if errs != nil {
		t.Fatalf("partial body must parse: %+v", errs)
	}
	if out.Name == nil || *out.Name != "Studio Two" {
		t.Fatalf("name: %+v", out.Name)
	}
	if out.PhotoURL != nil {
		t.Fatalf("photoUrl null clears: %+v", out.PhotoURL)
	}
	if out.Slug != nil || out.Timezone != nil {
		t.Fatal("absent fields must stay nil")
	}

	// photoUrl must be a URL when present.
	_, errs = DecodeUpdateOrganizerProfileInput([]byte(`{"photoUrl":"not a url"}`))
	if errs == nil || len(errs.Fields["photoUrl"]) == 0 {
		t.Fatalf("non-URL photoUrl must fail, got %+v", errs)
	}
}

func TestDecodeCancelAndLookupInputs(t *testing.T) {
	if _, errs := DecodeCancelBookingByTokenInput([]byte(`{"manageToken":"demo-manage-token-1"}`)); errs != nil {
		t.Fatalf("cancel by token: %+v", errs)
	}
	if _, errs := DecodeLookupBookingsInput([]byte(`{"guestTicket":"whatever-guest-ticket-12345678"}`)); errs != nil {
		t.Fatalf("lookup: %+v", errs)
	}
	if _, errs := DecodeCancelBookingByOrganizerInput([]byte(`{"bookingId":"not-a-uuid"}`)); errs == nil {
		t.Fatal("non-uuid bookingId must fail")
	}
}

func TestDecodeStorageInputs(t *testing.T) {
	if _, errs := DecodeCreateAvatarUploadInput([]byte(`{"contentType":"image/webp","size":500000}`)); errs != nil {
		t.Fatalf("avatar input: %+v", errs)
	}
	_, errs := DecodeCreateAvatarUploadInput([]byte(`{"contentType":"image/gif","size":100}`))
	if errs == nil || len(errs.Fields["contentType"]) == 0 {
		t.Fatalf("gif must be rejected, got %+v", errs)
	}
	_, errs = DecodeCreateAvatarUploadInput([]byte(`{"contentType":"image/webp","size":5000000}`))
	if errs == nil || len(errs.Fields["size"]) == 0 {
		t.Fatalf("oversized avatar must be rejected, got %+v", errs)
	}
}

// Length bounds count Unicode code points (kin-openapi's minLength/
// maxLength), which matches JavaScript String.length for the BMP — the
// conscious trade-off of ADR-016 (UTF-16 charLen parity was given up).
func TestStringLengthCountsCodePoints(t *testing.T) {
	cyrillic := strings.Repeat("я", 100) // 200 bytes, 100 code points
	body := `{"title":"` + cyrillic + `","defaultPrice":"€20","defaultCapacity":8,"defaultDurationMinutes":60,"maxSeatsPerBooking":2}`
	if _, errs := DecodeCreateServiceInput([]byte(body)); errs != nil {
		t.Fatalf("100-char Cyrillic title must pass, got %+v", errs)
	}
	tooLong := strings.Repeat("я", 101)
	body = `{"title":"` + tooLong + `","defaultPrice":"€20","defaultCapacity":8,"defaultDurationMinutes":60,"maxSeatsPerBooking":2}`
	if _, errs := DecodeCreateServiceInput([]byte(body)); errs == nil || len(errs.Fields["title"]) == 0 {
		t.Fatalf("101-char Cyrillic title must fail, got %+v", errs)
	}
}

// Zod's .trim() transform runs before the length checks; the decoders apply
// the same transform to the raw body.
func TestTrimTransformApplies(t *testing.T) {
	out, errs := DecodeCreateServiceInput([]byte(`{"title":"  Yoga  ","defaultPrice":"10","defaultCapacity":8,"defaultDurationMinutes":60,"maxSeatsPerBooking":2}`))
	if errs != nil {
		t.Fatalf("padded title must parse: %+v", errs)
	}
	if out.Title != "Yoga" {
		t.Fatalf("title must be trimmed, got %q", out.Title)
	}
	_, errs = DecodeCreateServiceInput([]byte(`{"title":"   ","defaultPrice":"10","defaultCapacity":8,"defaultDurationMinutes":60,"maxSeatsPerBooking":2}`))
	if errs == nil || len(errs.Fields["title"]) == 0 {
		t.Fatalf("whitespace-only title must fail after trim, got %+v", errs)
	}
}

// Merged-state refines: RFC 7386 deletes a key on null, so the non-nullable
// fields can go missing from the merged object — the refine turns that into
// the same 400 the old Optional[T] parser produced for null.
func TestRefineServiceMergedState(t *testing.T) {
	e := NewErrors()
	RefineServiceMergedState(e, &gen.UpdateServiceInput{})
	for _, key := range []string{"title", "defaultPrice", "defaultCapacity", "defaultDurationMinutes", "maxSeatsPerBooking"} {
		if len(e.Fields[key]) == 0 {
			t.Errorf("missing %s must be reported", key)
		}
	}

	mode := gen.Single
	options := gen.OptionsList{"A"}
	e = NewErrors()
	RefineServiceMergedState(e, &gen.UpdateServiceInput{
		Title:                  ptrOf(gen.DisplayName("x")),
		DefaultPrice:           ptrOf(gen.PriceText("10")),
		DefaultCapacity:        ptrOf(gen.Capacity(8)),
		DefaultDurationMinutes: ptrOf(gen.DurationMinutes(60)),
		MaxSeatsPerBooking:     ptrOf(gen.MaxSeatsPerBooking(2)),
		Options:                &options,
		OptionsSelectMode:      &mode,
	})
	if !e.Empty() {
		t.Fatalf("consistent merged state must pass, got %+v", e)
	}
}

func ptrOf[T any](v T) *T { return &v }

// rawObject must classify bodies the way Zod's safeParse does.
func TestRawObjectKinds(t *testing.T) {
	for name, body := range map[string]string{"empty": "", "null": "null", "array": "[]", "garbage": "not json"} {
		_, errs := rawObject([]byte(body))
		if errs == nil || len(errs.Form) == 0 {
			t.Errorf("%s: want form error, got %+v", name, errs)
		}
	}
	m, errs := rawObject([]byte(`{"a":1}`))
	if errs != nil {
		t.Fatalf("object must parse: %+v", errs)
	}
	if _, ok := m["a"]; !ok {
		t.Fatal("key a must be present")
	}
}

// trimJSONValue must handle strings and string arrays in place.
func TestTrimJSONValue(t *testing.T) {
	m := map[string]json.RawMessage{}
	m["title"] = json.RawMessage(`"  x  "`)
	trimJSONKey(m, "title")
	if string(m["title"]) != `"x"` {
		t.Fatalf("string trim: %s", m["title"])
	}
	m["options"] = json.RawMessage(`[" a ","b  "]`)
	trimJSONKey(m, "options")
	var opts []string
	if err := json.Unmarshal(m["options"], &opts); err != nil {
		t.Fatal(err)
	}
	if opts[0] != "a" || opts[1] != "b" {
		t.Fatalf("array trim: %v", opts)
	}
}
