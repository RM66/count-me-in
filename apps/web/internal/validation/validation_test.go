package validation

import (
	"strings"
	"testing"
	"time"

	"countmein/internal/contracts"
)

const (
	validServiceID = "demo-yoga"
	validSlotID    = "01930000-0000-7000-8000-0000000a0001"
)

func TestParseCreateBookingInputValid(t *testing.T) {
	body := `{"serviceId":"` + validServiceID + `","timeSlotId":"` + validSlotID +
		`","seats":2,"guestName":"Mila Petrović","guestTicket":"whatever-guest-ticket-12345678",` +
		`"selectedOptions":["Riverside studio"],"guestLocale":"ru"}`
	out, errs := ParseCreateBookingInput([]byte(body))
	if errs != nil {
		t.Fatalf("valid body must parse: %+v", errs)
	}
	if out.ServiceID != validServiceID || out.TimeSlotID != validSlotID || out.Seats != 2 ||
		out.GuestName != "Mila Petrović" || out.GuestLocale != "ru" ||
		len(out.SelectedOptions) != 1 || out.SelectedOptions[0] != "Riverside studio" {
		t.Fatalf("unexpected output: %+v", out)
	}
}

func TestParseCreateBookingInputDefaultsAndErrors(t *testing.T) {
	// guestLocale absent → default en.
	out, errs := ParseCreateBookingInput([]byte(`{
		"serviceId":"` + validServiceID + `", "timeSlotId":"` + validSlotID + `",
		"seats":1, "guestName":"Noah", "guestTicket":"whatever-guest-ticket-12345678"}`))
	if errs != nil {
		t.Fatalf("minimal valid body must parse: %+v", errs)
	}
	if out.GuestLocale != contracts.DefaultLocale {
		t.Fatalf("guestLocale must default to en, got %q", out.GuestLocale)
	}
	if out.SelectedOptions != nil {
		t.Fatalf("selectedOptions absent → nil, got %v", out.SelectedOptions)
	}

	// Missing seats + bad types.
	_, errs = ParseCreateBookingInput([]byte(`{"serviceId":"` + validServiceID + `","timeSlotId":"` + validSlotID + `","guestName":"Noah","guestTicket":"whatever-guest-ticket-12345678"}`))
	if errs == nil || len(errs.Fields["seats"]) == 0 {
		t.Fatalf("missing seats must be a field error, got %+v", errs)
	}
	_, errs = ParseCreateBookingInput([]byte(`{"serviceId":123,"timeSlotId":"` + validSlotID + `","seats":1,"guestName":"Noah","guestTicket":"whatever-guest-ticket-12345678"}`))
	if errs == nil || len(errs.Fields["serviceId"]) == 0 {
		t.Fatalf("serviceId number must be a field error, got %+v", errs)
	}
	// seats float.
	_, errs = ParseCreateBookingInput([]byte(`{"serviceId":"` + validServiceID + `","timeSlotId":"` + validSlotID + `","seats":1.5,"guestName":"Noah","guestTicket":"whatever-guest-ticket-12345678"}`))
	if errs == nil || len(errs.Fields["seats"]) == 0 {
		t.Fatalf("fractional seats must be a field error, got %+v", errs)
	}
	// selectedOptions null → invalid (optional, not nullable).
	_, errs = ParseCreateBookingInput([]byte(`{"serviceId":"` + validServiceID + `","timeSlotId":"` + validSlotID + `","seats":1,"guestName":"Noah","guestTicket":"whatever-guest-ticket-12345678","selectedOptions":null}`))
	if errs == nil || len(errs.Fields["selectedOptions"]) == 0 {
		t.Fatalf("selectedOptions null must be a field error, got %+v", errs)
	}
}

func TestParseCreateBookingInputMalformedBodies(t *testing.T) {
	for name, body := range map[string]string{"empty": "", "null": "null", "array": "[]", "garbage": "not json"} {
		_, errs := ParseCreateBookingInput([]byte(body))
		if errs == nil || len(errs.Form) == 0 {
			t.Errorf("%s: want form error, got %+v", name, errs)
		}
	}
}

func TestParseUpdateServiceInputPartialNullSemantics(t *testing.T) {
	out, errs := ParseUpdateServiceInput([]byte(`{"title":"New title","description":null}`))
	if errs != nil {
		t.Fatalf("partial body must parse: %+v", errs)
	}
	if !out.Title.Set || out.Title.Value == nil || *out.Title.Value != "New title" {
		t.Fatalf("title: %+v", out.Title)
	}
	if !out.Description.Set || out.Description.Value != nil {
		t.Fatalf("description null must be Set with nil value: %+v", out.Description)
	}
	if out.Location.Set {
		t.Fatal("location absent must not be Set")
	}
	if out.DefaultCapacity.Set {
		t.Fatal("defaultCapacity absent must not be Set")
	}
}

func TestParseUpdateServiceInputOptionsConsistency(t *testing.T) {
	_, errs := ParseUpdateServiceInput([]byte(`{"options":["A","B"],"optionsSelectMode":null}`))
	if errs == nil || len(errs.Fields["optionsSelectMode"]) == 0 {
		t.Fatalf("options set with null mode must fail, got %+v", errs)
	}
	_, errs = ParseUpdateServiceInput([]byte(`{"options":null,"optionsSelectMode":null}`))
	if errs != nil {
		t.Fatalf("clearing both must parse, got %+v", errs)
	}
	_, errs = ParseUpdateServiceInput([]byte(`{"options":["A"],"optionsSelectMode":"single"}`))
	if errs != nil {
		t.Fatalf("options with mode must parse, got %+v", errs)
	}
	_, errs = ParseUpdateServiceInput([]byte(`{"optionsSelectMode":"multi"}`))
	if errs == nil || len(errs.Fields["optionsSelectMode"]) == 0 {
		t.Fatalf("mode without options must fail, got %+v", errs)
	}
}

func TestParseUpdateServiceInputNonNullableNullRejected(t *testing.T) {
	_, errs := ParseUpdateServiceInput([]byte(`{"title":null}`))
	if errs == nil || len(errs.Fields["title"]) == 0 {
		t.Fatalf("title null must be a field error, got %+v", errs)
	}
	_, errs = ParseUpdateServiceInput([]byte(`{"defaultCapacity":null}`))
	if errs == nil || len(errs.Fields["defaultCapacity"]) == 0 {
		t.Fatalf("defaultCapacity null must be a field error, got %+v", errs)
	}
}

func TestParseCreateTimeSlotInputPastRejected(t *testing.T) {
	past := time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339)
	_, errs := ParseCreateTimeSlotInput([]byte(`{"serviceId":"` + validServiceID + `","startsAt":"` + past + `","durationMinutes":60,"capacity":12}`))
	if errs == nil || !strings.Contains(strings.Join(errs.Fields["startsAt"], ";"), "future") {
		t.Fatalf("past slot must fail with the past message, got %+v", errs)
	}

	future := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	out, errs := ParseCreateTimeSlotInput([]byte(`{"serviceId":"` + validServiceID + `","startsAt":"` + future + `","durationMinutes":60,"capacity":12,"price":"$14"}`))
	if errs != nil {
		t.Fatalf("future slot must parse: %+v", errs)
	}
	if out.Price == nil || *out.Price != "$14" {
		t.Fatalf("price: %+v", out.Price)
	}
}

func TestParseUpdateTimeSlotInputTriState(t *testing.T) {
	out, errs := ParseUpdateTimeSlotInput([]byte(`{"price":null,"capacity":20}`))
	if errs != nil {
		t.Fatalf("price null must clear, got %+v", errs)
	}
	if !out.Price.Set || out.Price.Value != nil {
		t.Fatalf("price null → Set with nil: %+v", out.Price)
	}
	if !out.Capacity.Set || out.Capacity.Value == nil || *out.Capacity.Value != 20 {
		t.Fatalf("capacity: %+v", out.Capacity)
	}
	if out.StartsAt.Set {
		t.Fatal("startsAt absent must not be Set")
	}
}

func TestParseRegisterOrganizerInputSlugRules(t *testing.T) {
	out, errs := ParseRegisterOrganizerInput([]byte(`{
		"ticket":"whatever-guest-ticket-12345678","slug":"My-Studio","name":"Studio",
		"timezone":"Europe/Belgrade","contact":"studio@example.com"}`))
	if errs != nil {
		t.Fatalf("valid register body must parse: %+v", errs)
	}
	if out.Slug != "my-studio" {
		t.Fatalf("slug must be lowercased, got %q", out.Slug)
	}
	if out.Language != contracts.DefaultLocale {
		t.Fatalf("language must default to en, got %q", out.Language)
	}

	for name, slug := range map[string]string{
		"reserved":  "demo",
		"reserved2": "api",
		"too short": "abc",
		"bad chars": "my studio",
	} {
		_, errs := ParseRegisterOrganizerInput([]byte(`{"ticket":"whatever-guest-ticket-12345678","slug":"` + slug + `","name":"Studio","timezone":"Europe/Belgrade"}`))
		if errs == nil || len(errs.Fields["slug"]) == 0 {
			t.Errorf("%s slug %q must be rejected, got %+v", name, slug, errs)
		}
	}

	_, errs = ParseRegisterOrganizerInput([]byte(`{"ticket":"whatever-guest-ticket-12345678","slug":"my-studio","name":"Studio","timezone":"Not/AZone"}`))
	if errs == nil || len(errs.Fields["timezone"]) == 0 {
		t.Fatalf("bad timezone must be rejected, got %+v", errs)
	}
}

func TestParseUpdateOrganizerProfileInput(t *testing.T) {
	out, errs := ParseUpdateOrganizerProfileInput([]byte(`{"name":"Studio Two","photoUrl":null}`))
	if errs != nil {
		t.Fatalf("partial body must parse: %+v", errs)
	}
	if !out.Name.Set || *out.Name.Value != "Studio Two" {
		t.Fatalf("name: %+v", out.Name)
	}
	if !out.PhotoURL.Set || out.PhotoURL.Value != nil {
		t.Fatalf("photoUrl null clears: %+v", out.PhotoURL)
	}
	if out.Slug.Set || out.Timezone.Set {
		t.Fatal("absent fields must not be Set")
	}

	// photoUrl must be a URL when present.
	_, errs = ParseUpdateOrganizerProfileInput([]byte(`{"photoUrl":"not a url"}`))
	if errs == nil || len(errs.Fields["photoUrl"]) == 0 {
		t.Fatalf("non-URL photoUrl must fail, got %+v", errs)
	}
}

func TestParseCancelAndLookupInputs(t *testing.T) {
	if _, errs := ParseCancelBookingByTokenInput([]byte(`{"manageToken":"demo-manage-token-1"}`)); errs != nil {
		t.Fatalf("cancel by token: %+v", errs)
	}
	if _, errs := ParseLookupBookingsInput([]byte(`{"guestTicket":"whatever-guest-ticket-12345678"}`)); errs != nil {
		t.Fatalf("lookup: %+v", errs)
	}
	if _, errs := ParseCancelBookingByOrganizerInput([]byte(`{"bookingId":"not-a-uuid"}`)); errs == nil {
		t.Fatal("non-uuid bookingId must fail")
	}
}

func TestParseStorageInputs(t *testing.T) {
	if _, errs := ParseCreateAvatarUploadInput([]byte(`{"contentType":"image/webp","size":500000}`)); errs != nil {
		t.Fatalf("avatar input: %+v", errs)
	}
	_, errs := ParseCreateAvatarUploadInput([]byte(`{"contentType":"image/gif","size":100}`))
	if errs == nil || len(errs.Fields["contentType"]) == 0 {
		t.Fatalf("gif must be rejected, got %+v", errs)
	}
	_, errs = ParseCreateAvatarUploadInput([]byte(`{"contentType":"image/webp","size":5000000}`))
	if errs == nil || len(errs.Fields["size"]) == 0 {
		t.Fatalf("oversized avatar must be rejected, got %+v", errs)
	}
}
