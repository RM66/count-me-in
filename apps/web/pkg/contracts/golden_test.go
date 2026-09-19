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
)

var update = flag.Bool("update", false, "rewrite golden files")

func goldenTime() string {
	return ISODate(time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC))
}

func goldenUUID(n int) string {
	return "01930000-0000-7000-8000-0000000000" + string(rune('0'+n/10)) + string(rune('0'+n%10))
}

func strptr(s string) *string { return &s }

func sampleOrganizerProfile() OrganizerProfile {
	return OrganizerProfile{
		ID:          goldenUUID(1),
		Slug:        "my-studio",
		Name:        "Studio",
		Messenger:   MessengerTelegram,
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

func samplePublicOrganizer() PublicOrganizer {
	return PublicOrganizer{
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

func sampleServiceRecord() ServiceRecord {
	mode := OptionsSingle
	return ServiceRecord{
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
		Options:                []string{"Beginner", "Intermediate"},
		OptionsSelectMode:      &mode,
		CreatedAt:              goldenTime(),
	}
}

func sampleTimeSlotRecord() TimeSlotRecord {
	return TimeSlotRecord{
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

func sampleBookingRecord() BookingRecord {
	return BookingRecord{
		ID:                  goldenUUID(3),
		TimeSlotID:          goldenUUID(2),
		Status:              BookingConfirmed,
		Seats:               2,
		GuestName:           "Mila Petrović",
		GuestMessenger:      MessengerTelegram,
		GuestMessengerID:    "123456789",
		GuestMessengerLogin: strptr("mila"),
		SelectedOptions:     []string{"Beginner"},
		CreatedAt:           goldenTime(),
	}
}

func sampleGuestBooking() GuestBooking {
	return GuestBooking{
		ID:              goldenUUID(3),
		Status:          BookingConfirmed,
		Seats:           2,
		GuestName:       "Mila Petrović",
		SelectedOptions: []string{"Beginner"},
		CreatedAt:       goldenTime(),
		ManageToken:     "manage-token-1234567890",
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
	demoProfile.ID = DemoOrganizerID
	demoProfile.Slug = DemoOrganizerSlug
	demoProfile.IsDemo = true

	demoPublic := public
	demoPublic.ID = DemoOrganizerID
	demoPublic.Slug = DemoOrganizerSlug
	demoPublic.IsDemo = true

	maxProfile := organizer
	maxProfile.Name = strings.Repeat("я", 100)
	maxProfile.Description = strptr(strings.Repeat("x", 4000))

	maxService := service
	maxService.Title = strings.Repeat("я", 100)
	maxService.Description = strptr(strings.Repeat("x", 2000))
	maxService.DefaultPrice = strings.Repeat("9", 50)
	maxService.Options = []string{strings.Repeat("o", 100)}

	payload := AuthTicketPayload{
		Messenger:      MessengerTelegram,
		MessengerID:    "123456789",
		DisplayName:    "Mila Petrović",
		PhotoURL:       strptr("https://example.com/avatar.webp"),
		MessengerLogin: strptr("mila"),
	}
	payloadNulls := AuthTicketPayload{
		Messenger:   MessengerTelegram,
		MessengerID: "123456789",
		DisplayName: "Mila Petrović",
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
		"ImageUploadTarget": ImageUploadTarget{
			UploadURL: "https://upload.example.com/put",
			PublicURL: "https://example.com/avatar.webp",
			ExpiresAt: goldenTime(),
		},
		"RegisteredOrganizer":     RegisteredOrganizer{ID: goldenUUID(1), Slug: "my-studio"},
		"Registered":              Registered{Organizer: RegisteredOrganizer{ID: goldenUUID(1), Slug: "my-studio"}},
		"AuthTicketPayload":       payload,
		"AuthTicketPayload.nulls": payloadNulls,
		"GuestTicketResponse": GuestTicketResponse{
			Ticket:      "whatever-guest-ticket-12345678",
			Messenger:   MessengerTelegram,
			MessengerID: "123456789",
			DisplayName: "Mila Petrović",
		},
		"AuthTicketResponse": AuthTicketResponse{Ticket: "whatever-auth-ticket-12345678", OrganizerExists: true},
		"LoginLinkPayload":   LoginLinkPayload{OrganizerID: goldenUUID(1), Next: "/cabinet"},
		"BookingCreatedJob":  BookingCreatedJob{BookingID: goldenUUID(3), Recipient: RecipientOrganizer},
		"BookingCancelledJob": BookingCancelledJob{
			BookingID:   goldenUUID(3),
			CancelledBy: ActorGuest,
		},
		"ServiceEnvelope":        ServiceEnvelope{Service: service},
		"ServicesEnvelope":       ServicesEnvelope{Services: []ServiceRecord{service}},
		"SlotEnvelope":           SlotEnvelope{Slot: slot},
		"SlotsEnvelope":          SlotsEnvelope{Slots: []TimeSlotRecord{slot}},
		"GuestBookingEnvelope":   GuestBookingEnvelope{Booking: guest},
		"BookingEnvelope":        BookingEnvelope{Booking: booking},
		"GuestBookingsEnvelope":  GuestBookingsEnvelope{Bookings: []GuestBooking{guest}},
		"OrganizerEnvelope":      OrganizerEnvelope{Organizer: organizer},
		"OrganizerEnvelope.demo": OrganizerEnvelope{Organizer: demoProfile},
		"DeletedServiceEnvelope": DeletedServiceEnvelope{ID: "demo-yoga"},
		"DeletedSlotEnvelope":    DeletedSlotEnvelope{ID: goldenUUID(2)},
		"ErrorBody": ErrorBody{
			Error:     "Only 4 seats left",
			Code:      strptr("seats_left"),
			SeatsLeft: &seatsLeft,
			MaxSeats:  &maxSeats,
		},
		"ErrorBody.nulls": ErrorBody{Error: "Something went wrong"},
		"ValidationErrors": ValidationErrors{
			FormErrors:  []string{},
			FieldErrors: map[string][]string{"title": {"Required"}},
		},
		"InvalidBody": InvalidBody{
			Error: "Invalid input",
			Details: ValidationErrors{
				FormErrors:  []string{},
				FieldErrors: map[string][]string{"title": {"Required"}},
			},
		},
		"InvalidIssuesBody": InvalidIssuesBody{
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
	for _, n := range RecordNames {
		if !seen[n] {
			t.Errorf("RecordNames entry %q has no golden sample", n)
		}
	}
	for base := range seen {
		found := false
		for _, n := range RecordNames {
			if n == base {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("golden sample %q is not in RecordNames", base)
		}
	}
}
