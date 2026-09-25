package contracts

import (
	"bytes"
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	gen "countmein/pkg/api/gen"
)

var update = flag.Bool("update", false, "rewrite golden files")

// recordNames — the wire records (was RecordNames in the retired
// constants_gen.go); TestGoldenCoverage pins the list against the samples.
var recordNames = []string{
	"OrganizerProfile", "PublicOrganizer", "ServiceRecord", "TimeSlotRecord",
	"BookingRecord", "GuestBooking", "ImageUploadTarget", "RegisteredOrganizer",
	"Registered", "AuthTicketPayload", "GuestTicketResponse", "AuthTicketResponse",
	"LoginLinkPayload", "BookingCreatedJob", "BookingCancelledJob",
	"ServiceEnvelope", "ServicesEnvelope", "SlotEnvelope", "SlotsEnvelope",
	"GuestBookingEnvelope", "BookingEnvelope", "GuestBookingsEnvelope",
	"OrganizerEnvelope", "DeletedServiceEnvelope", "DeletedSlotEnvelope",
	"ErrorBody", "ValidationErrors", "InvalidBody", "InvalidIssuesBody",
}

func goldenTime() string {
	return ISODate(time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC))
}

func goldenUUID(n int) gen.UUID {
	return ToUUID("01930000-0000-7000-8000-0000000000" + string(rune('0'+n/10)) + string(rune('0'+n%10)))
}

// strSlicePtr wraps a string slice for the generated *[]string fields.
func strSlicePtr(s []string) *[]string { return &s }

func strptr(s string) *string { return &s }

func sampleOrganizerProfile() gen.OrganizerProfile {
	return gen.OrganizerProfile{
		ID:          goldenUUID(1),
		Slug:        "my-studio",
		Name:        "Studio",
		Messenger:   gen.Telegram,
		MessengerID: "123456789",
		Timezone:    "Europe/Belgrade",
		Description: strptr("Morning practice"),
		PhotoURL:    strptr("https://example.com/avatar.webp"),
		Location:    strptr("Hall A"),
		Contact:     strptr("+123456"),
		Language:    "ru",
		CreatedAt:   goldenTime(),
		IsDemo:      false,
	}
}

func samplePublicOrganizer() gen.PublicOrganizer {
	return gen.PublicOrganizer{
		ID:          goldenUUID(1),
		Slug:        "my-studio",
		Name:        "Studio",
		Timezone:    "Europe/Belgrade",
		Description: strptr("Morning practice"),
		PhotoURL:    strptr("https://example.com/avatar.webp"),
		Location:    strptr("Hall A"),
		Contact:     strptr("+123456"),
		IsDemo:      false,
	}
}

func sampleServiceRecord() gen.ServiceRecord {
	mode := gen.Single
	return gen.ServiceRecord{
		ID:                     "demo-yoga",
		OrganizerID:            goldenUUID(1),
		Title:                  "Yoga",
		Description:            strptr("Morning flow"),
		PhotoURL:               strptr("https://example.com/photo.webp"),
		Location:               strptr("Hall A"),
		Contact:                strptr("+123456"),
		DefaultPrice:           "10",
		DefaultCapacity:        5,
		DefaultDurationMinutes: 60,
		MaxSeatsPerBooking:     1,
		Options:                strSlicePtr([]string{"Beginner", "Intermediate"}),
		OptionsSelectMode:      &mode,
		CreatedAt:              goldenTime(),
	}
}

func sampleTimeSlotRecord() gen.TimeSlotRecord {
	return gen.TimeSlotRecord{
		ID:              goldenUUID(2),
		ServiceID:       "demo-yoga",
		StartsAt:        goldenTime(),
		DurationMinutes: 60,
		Capacity:        10,
		BookedCount:     3,
		Price:           strptr("15"),
		CreatedAt:       goldenTime(),
	}
}

func sampleBookingRecord() gen.BookingRecord {
	return gen.BookingRecord{
		ID:                  goldenUUID(3),
		TimeSlotID:          goldenUUID(2),
		Status:              gen.Confirmed,
		Seats:               2,
		GuestName:           "Mila Petrović",
		GuestMessenger:      gen.Telegram,
		GuestMessengerID:    "123456789",
		GuestMessengerLogin: strptr("mila"),
		SelectedOptions:     strSlicePtr([]string{"Beginner"}),
		CreatedAt:           goldenTime(),
	}
}

func sampleGuestBooking() gen.GuestBooking {
	return gen.GuestBooking{
		ID:              goldenUUID(3),
		Status:          gen.Confirmed,
		Seats:           2,
		GuestName:       "Mila Petrović",
		SelectedOptions: strSlicePtr([]string{"Beginner"}),
		CreatedAt:       goldenTime(),
		ManageToken:     "manage-token-1234567890",
		CanCancel:       true,
		Slot:            sampleTimeSlotRecord(),
		Service:         sampleServiceRecord(),
		Organizer:       samplePublicOrganizer(),
	}
}

func goldenSamples() map[string]any {
	service := sampleServiceRecord()
	serviceNulls := service
	serviceNulls.Description = nil
	serviceNulls.PhotoURL = nil
	serviceNulls.Location = nil
	serviceNulls.Contact = nil
	serviceNulls.Options = nil
	serviceNulls.OptionsSelectMode = nil

	slot := sampleTimeSlotRecord()
	slotNulls := slot
	slotNulls.Price = nil

	booking := sampleBookingRecord()
	bookingNulls := booking
	bookingNulls.GuestMessengerLogin = nil
	bookingNulls.SelectedOptions = nil

	guest := sampleGuestBooking()
	guestNulls := guest
	guestNulls.SelectedOptions = nil

	organizer := sampleOrganizerProfile()
	organizerNulls := organizer
	organizerNulls.Description = nil
	organizerNulls.PhotoURL = nil
	organizerNulls.Location = nil
	organizerNulls.Contact = nil

	public := samplePublicOrganizer()
	publicNulls := public
	publicNulls.Description = nil
	publicNulls.PhotoURL = nil
	publicNulls.Location = nil
	publicNulls.Contact = nil

	demoProfile := organizer
	demoProfile.ID = ToUUID(DemoOrganizerID)
	demoProfile.Slug = DemoOrganizerSlug
	demoProfile.IsDemo = true

	demoPublic := public
	demoPublic.ID = ToUUID(DemoOrganizerID)
	demoPublic.Slug = DemoOrganizerSlug
	demoPublic.IsDemo = true

	maxProfile := organizer
	maxProfile.Name = strings.Repeat("я", 100)
	maxProfile.Description = strptr(strings.Repeat("x", 4000))

	maxService := service
	maxService.Title = strings.Repeat("я", 100)
	maxService.Description = strptr(strings.Repeat("x", 2000))
	maxService.DefaultPrice = strings.Repeat("9", 50)
	maxService.Options = strSlicePtr([]string{strings.Repeat("o", 100)})

	payload := AuthTicketPayload{
		Messenger:      gen.Telegram,
		MessengerID:    "123456789",
		DisplayName:    "Mila Petrović",
		PhotoURL:       strptr("https://example.com/avatar.webp"),
		MessengerLogin: strptr("mila"),
		Purpose:        "guest",
	}
	payloadNulls := AuthTicketPayload{
		Messenger:   gen.Telegram,
		MessengerID: "123456789",
		DisplayName: "Mila Petrović",
		Purpose:     "organizer",
	}

	seatsLeft := 4
	maxSeats := 6

	return map[string]any{
		"OrganizerProfile":        organizer,
		"OrganizerProfile.nulls":  organizerNulls,
		"OrganizerProfile.demo":   demoProfile,
		"OrganizerProfile.bounds": maxProfile,
		"PublicOrganizer":         public,
		"PublicOrganizer.nulls":   publicNulls,
		"PublicOrganizer.demo":    demoPublic,
		"ServiceRecord":           service,
		"ServiceRecord.nulls":     serviceNulls,
		"ServiceRecord.bounds":    maxService,
		"TimeSlotRecord":          slot,
		"TimeSlotRecord.nulls":    slotNulls,
		"BookingRecord":           booking,
		"BookingRecord.nulls":     bookingNulls,
		"GuestBooking":            guest,
		"GuestBooking.nulls":      guestNulls,
		"ImageUploadTarget": gen.ImageUploadTarget{
			UploadURL: "https://upload.example.com/put",
			PublicURL: "https://example.com/avatar.webp",
			ExpiresAt: goldenTime(),
		},
		"RegisteredOrganizer":     gen.RegisteredOrganizer{ID: goldenUUID(1), Slug: "my-studio"},
		"Registered":              gen.Registered{Organizer: gen.RegisteredOrganizer{ID: goldenUUID(1), Slug: "my-studio"}},
		"AuthTicketPayload":       payload,
		"AuthTicketPayload.nulls": payloadNulls,
		"GuestTicketResponse": gen.GuestTicketResponse{
			Ticket:      "whatever-guest-ticket-12345678",
			Messenger:   gen.Telegram,
			MessengerID: "123456789",
			DisplayName: "Mila Petrović",
		},
		"AuthTicketResponse": gen.AuthTicketResponse{Ticket: "whatever-auth-ticket-12345678", OrganizerExists: true},
		"LoginLinkPayload":   LoginLinkPayload{OrganizerID: UUIDString(goldenUUID(1)), Next: "/cabinet"},
		"BookingCreatedJob":  gen.BookingCreatedJob{BookingID: goldenUUID(3), Recipient: gen.NotificationRecipientOrganizer},
		"BookingCancelledJob": gen.BookingCancelledJob{
			BookingID:   goldenUUID(3),
			CancelledBy: gen.CancelActorGuest,
		},
		"ServiceEnvelope":        gen.ServiceEnvelope{Service: service},
		"ServicesEnvelope":       gen.ServicesEnvelope{Services: []gen.ServiceRecord{service}},
		"SlotEnvelope":           gen.SlotEnvelope{Slot: slot},
		"SlotsEnvelope":          gen.SlotsEnvelope{Slots: []gen.TimeSlotRecord{slot}},
		"GuestBookingEnvelope":   gen.GuestBookingEnvelope{Booking: guest},
		"BookingEnvelope":        gen.BookingEnvelope{Booking: booking},
		"GuestBookingsEnvelope":  gen.GuestBookingsEnvelope{Bookings: []gen.GuestBooking{guest}},
		"OrganizerEnvelope":      gen.OrganizerEnvelope{Organizer: organizer},
		"OrganizerEnvelope.demo": gen.OrganizerEnvelope{Organizer: demoProfile},
		"DeletedServiceEnvelope": gen.DeletedServiceEnvelope{ID: "demo-yoga"},
		"DeletedSlotEnvelope":    gen.DeletedSlotEnvelope{ID: goldenUUID(2)},
		"ErrorBody": gen.ErrorBody{
			Error:     "Only 4 seats left",
			Code:      strptr("seats_left"),
			SeatsLeft: &seatsLeft,
			MaxSeats:  &maxSeats,
		},
		"ErrorBody.nulls": gen.ErrorBody{Error: "Something went wrong"},
		"ValidationErrors": gen.ValidationErrors{
			FormErrors:  []string{},
			FieldErrors: map[string][]string{"title": {"Required"}},
		},
		"InvalidBody": gen.InvalidBody{
			Error: "Invalid input",
			Details: gen.ValidationErrors{
				FormErrors:  []string{},
				FieldErrors: map[string][]string{"title": {"Required"}},
			},
		},
		"InvalidIssuesBody": gen.InvalidIssuesBody{
			Error:  "Invalid input",
			Issues: map[string][]string{"slug": {"this slug is reserved for system use — please choose another"}},
		},
	}
}

func TestGolden(t *testing.T) {
	dir := filepath.Join("testdata", "golden")
	samples := goldenSamples()
	keys := make([]string, 0, len(samples))
	for k := range samples {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, key := range keys {
		data, err := json.MarshalIndent(samples[key], "", "  ")
		if err != nil {
			t.Fatalf("marshal %s: %v", key, err)
		}
		data = append(data, '\n')
		path := filepath.Join(dir, key+".json")
		if *update {
			if err := os.MkdirAll(dir, 0o755); err != nil {
				t.Fatalf("mkdir %s: %v", dir, err)
			}
			if err := os.WriteFile(path, data, 0o644); err != nil {
				t.Fatalf("write %s: %v", path, err)
			}
			continue
		}
		want, err := os.ReadFile(path)
		if err != nil {
			t.Errorf("%s: %v — run go test ./pkg/contracts -run Golden -update if the wire change is intentional", key, err)
			continue
		}
		if !bytes.Equal(data, want) {
			t.Errorf("%s: golden mismatch — run go test ./pkg/contracts -run Golden -update if the wire change is intentional", key)
		}
	}
}

func TestGoldenCoverage(t *testing.T) {
	seen := map[string]bool{}
	for key := range goldenSamples() {
		base := key
		// Variants ("OrganizerProfile.demo") pin edge shapes; coverage counts
		// only the base record name.
		if strings.Contains(key, ".") {
			continue
		}
		if seen[base] {
			t.Errorf("duplicate golden sample %q", key)
		}
		seen[base] = true
	}
	for _, n := range recordNames {
		if !seen[n] {
			t.Errorf("record %q has no golden sample", n)
		}
	}
	for base := range seen {
		found := false
		for _, n := range recordNames {
			if n == base {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("golden sample %q is not in the record list", base)
		}
	}
}
