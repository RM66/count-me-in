package db

import (
	"context"
	"time"

	"countmein/pkg/contracts"
)

// Demo organizer seed data (ADR-010), ported from
// packages/db/src/seed — the only copy of the sample content in Go.
//
// Two rules keep this seed usable long-term:
// 1. Deterministic ids — re-seeding replaces rows in place instead of
//    accumulating duplicates, and demo links stay stable.
// 2. Slot times relative to seed time, never absolute — offsets are
//    resolved against `now` at seed/refresh time, anchored on "the day
//    after the seed run" so a refresh always produces upcoming slots.

const (
	demoTimezone = "Europe/Belgrade"

	// Sentinel messenger id — deliberately not a real Telegram account,
	// so the demo can never be logged into via the widget.
	demoMessengerID = "demo-account"
)

var demoOrganizer = struct {
	Description *string
	PhotoURL    *string
	Location    *string
	Contact     *string
}{
	Description: strPtr(`**Boutique movement studio** in the heart of Belgrade.

Small-group **yoga**, **breathwork**, and **pottery** — come as you are, _beginners always welcome_.

What we offer:

- 🧘 Morning Vinyasa flow
- 🌬️ Evening breathwork circles
- 🏺 Hand-building pottery workshops

_This is a read-only demo page — [create your own](https://countmein.group/signup) in minutes._`),
	PhotoURL: strPtr("/organizer-avatar.png"),
	Location: strPtr("Kralja Petra 123, Belgrade"),
	Contact:  strPtr("studio@studiodemo.rs"),
}

// Deterministic demo slot ids (time_slots.id is a uuid column).
const (
	slotY1 = "01930000-0000-7000-8000-0000000a0001"
	slotY2 = "01930000-0000-7000-8000-0000000a0002"
	slotY3 = "01930000-0000-7000-8000-0000000a0003"
	slotY4 = "01930000-0000-7000-8000-0000000a0004"
	slotY5 = "01930000-0000-7000-8000-0000000a0005"
	slotY6 = "01930000-0000-7000-8000-0000000a0006"
	slotY7 = "01930000-0000-7000-8000-0000000a0007"
	slotY8 = "01930000-0000-7000-8000-0000000a0008"
	slotP1 = "01930000-0000-7000-8000-0000000b0001"
	slotP2 = "01930000-0000-7000-8000-0000000b0002"
	slotP3 = "01930000-0000-7000-8000-0000000b0003"
	slotP4 = "01930000-0000-7000-8000-0000000b0004"
	slotP5 = "01930000-0000-7000-8000-0000000b0005"
	slotB1 = "01930000-0000-7000-8000-0000000c0001"
	slotB2 = "01930000-0000-7000-8000-0000000c0002"
	slotB3 = "01930000-0000-7000-8000-0000000c0003"
	slotB4 = "01930000-0000-7000-8000-0000000c0004"
	slotB5 = "01930000-0000-7000-8000-0000000c0005"
	slotB6 = "01930000-0000-7000-8000-0000000c0006"
)

// Deterministic demo booking ids.
const (
	demoBooking01 = "01930000-0000-7000-8000-0000000d0001"
	demoBooking02 = "01930000-0000-7000-8000-0000000d0002"
	demoBooking03 = "01930000-0000-7000-8000-0000000d0003"
	demoBooking04 = "01930000-0000-7000-8000-0000000d0004"
	demoBooking05 = "01930000-0000-7000-8000-0000000d0005"
	demoBooking06 = "01930000-0000-7000-8000-0000000d0006"
	demoBooking07 = "01930000-0000-7000-8000-0000000d0007"
	demoBooking08 = "01930000-0000-7000-8000-0000000d0008"
	demoBooking09 = "01930000-0000-7000-8000-0000000d0009"
	demoBooking10 = "01930000-0000-7000-8000-0000000d000a"
	demoBooking11 = "01930000-0000-7000-8000-0000000d000b"
	demoBooking12 = "01930000-0000-7000-8000-0000000d000c"
	demoBooking13 = "01930000-0000-7000-8000-0000000d000d"
	demoBooking14 = "01930000-0000-7000-8000-0000000d000e"
	demoBooking15 = "01930000-0000-7000-8000-0000000d000f"
	demoBooking16 = "01930000-0000-7000-8000-0000000d0010"
	demoBooking17 = "01930000-0000-7000-8000-0000000d0011"
	demoBooking18 = "01930000-0000-7000-8000-0000000d0012"
	demoBooking19 = "01930000-0000-7000-8000-0000000d0013"
	demoBooking20 = "01930000-0000-7000-8000-0000000d0014"
	demoBooking21 = "01930000-0000-7000-8000-0000000d0015"
	demoBooking22 = "01930000-0000-7000-8000-0000000d0016"
	demoBooking23 = "01930000-0000-7000-8000-0000000d0017"
	demoBooking24 = "01930000-0000-7000-8000-0000000d0018"
	demoBooking25 = "01930000-0000-7000-8000-0000000d0019"
	demoBooking26 = "01930000-0000-7000-8000-0000000d001a"
	demoBooking27 = "01930000-0000-7000-8000-0000000d001b"
	demoBooking28 = "01930000-0000-7000-8000-0000000d001c"
	demoBooking29 = "01930000-0000-7000-8000-0000000d001d"
	demoBooking30 = "01930000-0000-7000-8000-0000000d001e"
	demoBooking31 = "01930000-0000-7000-8000-0000000d001f"
	demoBooking32 = "01930000-0000-7000-8000-0000000d0020"
	demoBooking33 = "01930000-0000-7000-8000-0000000d0021"
	demoBooking34 = "01930000-0000-7000-8000-0000000d0022"
	demoBooking35 = "01930000-0000-7000-8000-0000000d0023"
	demoBooking36 = "01930000-0000-7000-8000-0000000d0024"
	demoBooking37 = "01930000-0000-7000-8000-0000000d0025"
	demoBooking38 = "01930000-0000-7000-8000-0000000d0026"
	demoBooking39 = "01930000-0000-7000-8000-0000000d0027"
	demoBooking40 = "01930000-0000-7000-8000-0000000d0028"
)

type demoService struct {
	ID                     string
	Title                  string
	Description            *string
	PhotoURL               *string
	Location               *string
	Contact                *string
	DefaultPrice           string
	DefaultCapacity        int
	DefaultDurationMinutes int
	MaxSeatsPerBooking     int
	Options                []string
	OptionsSelectMode      *string
}

var demoServices = []demoService{
	{
		ID:    contracts.DemoServiceYoga,
		Title: "Morning Vinyasa Flow",
		Description: strPtr("A dynamic 60-minute flow to wake up the body and mind. " +
			"Suitable for all levels. Mats and props provided."),
		PhotoURL:               strPtr("/service-yoga.png"),
		DefaultPrice:           "$12",
		DefaultCapacity:        12,
		DefaultDurationMinutes: 60,
		MaxSeatsPerBooking:     2,
		Options:                []string{"Downtown studio", "Riverside studio"},
		OptionsSelectMode:      strPtr("single"),
	},
	{
		ID:    contracts.DemoServicePottery,
		Title: "Hand-Building Pottery Workshop",
		Description: strPtr("Shape your own mug or bowl from scratch. All clay, tools, and firing included. " +
			"Great for a creative afternoon with friends."),
		PhotoURL:               strPtr("/service-workshop.png"),
		Location:               strPtr("Ceramics Loft, Cetinjska 15, Belgrade"),
		Contact:                strPtr("+381 64 999 1234"),
		DefaultPrice:           "from $25",
		DefaultCapacity:        8,
		DefaultDurationMinutes: 120,
		MaxSeatsPerBooking:     4,
		Options:                []string{"Bring a friend (+1 seat)", "Take-home glaze kit", "Photo of your piece"},
		OptionsSelectMode:      strPtr("multi"),
	},
	{
		ID:    contracts.DemoServiceBreathwork,
		Title: "Evening Breathwork Circle",
		Description: strPtr("A calming 45-minute guided breathwork session to close out your day. " +
			"Dim lights, warm blankets, deep rest."),
		PhotoURL:               strPtr("/service-breathwork.png"),
		DefaultPrice:           "$9",
		DefaultCapacity:        16,
		DefaultDurationMinutes: 45,
		MaxSeatsPerBooking:     1,
	},
}

// Slot templates: dayOffset/hour resolve against the day *after* the
// seed run, so a refresh always produces a week of strictly upcoming
// slots. Negative dayOffsets produce past slots — history for the
// analytics; they keep their bookings.
type slotTemplate struct {
	ID              string
	ServiceID       string
	DayOffset       int
	Hour            int
	DurationMinutes int
	Capacity        int
	BookedCount     int
	Price           *string
}

var demoSlotTemplates = []slotTemplate{
	// Yoga — a mix of open, filling and full so the UI shows every state.
	{slotY1, contracts.DemoServiceYoga, 0, 7, 60, 12, 9, nil},
	{slotY2, contracts.DemoServiceYoga, 1, 7, 60, 12, 12, nil},
	{slotY3, contracts.DemoServiceYoga, 2, 7, 60, 12, 4, nil},
	{slotY4, contracts.DemoServiceYoga, 3, 7, 60, 12, 1, strPtr("$14")},
	// Past yoga slots (history).
	{slotY5, contracts.DemoServiceYoga, -3, 7, 60, 12, 12, nil},
	{slotY6, contracts.DemoServiceYoga, -10, 7, 60, 12, 10, nil},
	{slotY7, contracts.DemoServiceYoga, -17, 7, 60, 12, 8, nil},
	{slotY8, contracts.DemoServiceYoga, -24, 7, 60, 12, 11, nil},
	// Pottery.
	{slotP1, contracts.DemoServicePottery, 1, 15, 120, 8, 5, nil},
	{slotP2, contracts.DemoServicePottery, 4, 15, 120, 8, 8, nil},
	{slotP3, contracts.DemoServicePottery, 6, 11, 120, 8, 2, nil},
	{slotP4, contracts.DemoServicePottery, -5, 15, 120, 8, 8, nil},
	{slotP5, contracts.DemoServicePottery, -19, 11, 120, 8, 6, nil},
	// Breathwork.
	{slotB1, contracts.DemoServiceBreathwork, 0, 18, 45, 16, 11, nil},
	{slotB2, contracts.DemoServiceBreathwork, 2, 18, 45, 16, 16, nil},
	{slotB3, contracts.DemoServiceBreathwork, 5, 18, 45, 16, 6, nil},
	{slotB4, contracts.DemoServiceBreathwork, -2, 18, 45, 16, 16, nil},
	{slotB5, contracts.DemoServiceBreathwork, -9, 18, 45, 16, 14, nil},
	{slotB6, contracts.DemoServiceBreathwork, -16, 18, 45, 16, 13, nil},
}

// Illustrative bookings for the cabinet's bookings table and analytics.
// Manage tokens are generated fresh on every seed run (never committed
// constants): the demo account rejects every write path (ADR-010), but
// committed tokens still end up in backups and logs — random per run is
// strictly better and costs nothing, since slots+bookings are replaced
// wholesale on each refresh.
type bookingTemplate struct {
	ID               string
	TimeSlotID       string
	Cancelled        bool
	Seats            int
	GuestName        string
	GuestMessengerID string
	GuestLogin       *string
	SelectedOptions  []string
	DaysAgo          int
}

var demoBookingTemplates = []bookingTemplate{
	// ── Recent (last 7 days) — drives the trend chart. ─────────────────
	{demoBooking01, slotY1, false, 2, "Mila Petrović", "demo-guest-1", strPtr("@milapetrovic"), []string{"Downtown studio"}, 2},
	{demoBooking02, slotP1, false, 1, "Noah Ellis", "demo-guest-2", nil, []string{"Take-home glaze kit", "Photo of your piece"}, 3},
	{demoBooking03, slotB1, false, 1, "Ana Kovač", "demo-guest-3", strPtr("@ana_kovac"), nil, 1},
	{demoBooking04, slotY3, false, 3, "Luka Jovanović", "demo-guest-4", strPtr("@lukajovanovic"), []string{"Riverside studio"}, 1},
	{demoBooking05, slotP1, true, 1, "Sara Nikolić", "demo-guest-5", strPtr("@sara_nikolic"), nil, 4},
	{demoBooking06, slotB2, false, 1, "Elena Marković", "demo-guest-6", strPtr("@elenamarkovic"), nil, 5},
	{demoBooking07, slotB2, false, 1, "Filip Stanković", "demo-guest-7", strPtr("@filips"), nil, 6},
	{demoBooking08, slotY2, false, 2, "Jelena Popović", "demo-guest-8", strPtr("@jelenap"), []string{"Downtown studio"}, 6},
	// ── 8–30 days ago — fills the 30-day window. ──────────────────────
	{demoBooking09, slotY5, false, 2, "Marko Đorđević", "demo-guest-9", strPtr("@markod"), []string{"Riverside studio"}, 8},
	{demoBooking10, slotB3, false, 1, "Tijana Radosavljević", "demo-guest-10", strPtr("@tijanar"), nil, 9},
	{demoBooking11, slotP4, false, 2, "Andrej Simić", "demo-guest-11", strPtr("@andrejs"), []string{"Bring a friend (+1 seat)"}, 10},
	{demoBooking12, slotY6, false, 1, "Katarina Lukić", "demo-guest-12", strPtr("@katarinal"), []string{"Downtown studio"}, 12},
	{demoBooking13, slotB5, false, 1, "Nikola Vuković", "demo-guest-13", strPtr("@nikolav"), nil, 13},
	{demoBooking14, slotY5, true, 1, "Petra Janković", "demo-guest-14", strPtr("@petraj"), []string{"Downtown studio"}, 14},
	{demoBooking15, slotP4, false, 1, "Stefan Antić", "demo-guest-15", strPtr("@stefana"), []string{"Photo of your piece"}, 15},
	{demoBooking16, slotY6, false, 2, "Olga Branković", "demo-guest-16", strPtr("@olgab"), []string{"Riverside studio"}, 16},
	{demoBooking17, slotB5, false, 1, "Dušan Pavlović", "demo-guest-17", strPtr("@dusanp"), nil, 17},
	{demoBooking18, slotY7, false, 1, "Maja Ilić", "demo-guest-18", strPtr("@majailic"), []string{"Downtown studio"}, 18},
	{demoBooking19, slotP5, false, 2, "Bogdan Zarić", "demo-guest-19", strPtr("@bogdanz"), []string{"Bring a friend (+1 seat)", "Take-home glaze kit"}, 19},
	{demoBooking20, slotB6, false, 1, "Tamara Cvetković", "demo-guest-20", strPtr("@tamarac"), nil, 20},
	{demoBooking21, slotY7, false, 2, "Vladimir Nikolić", "demo-guest-21", strPtr("@vladimirn"), []string{"Riverside studio"}, 21},
	{demoBooking22, slotP5, true, 1, "Isidora Milovanović", "demo-guest-22", strPtr("@isidoram"), nil, 22},
	{demoBooking23, slotY8, false, 1, "Aleksandar Tomić", "demo-guest-23", strPtr("@aleksandart"), []string{"Downtown studio"}, 23},
	{demoBooking24, slotB6, false, 1, "Natalija Pavlović", "demo-guest-24", strPtr("@natalijap"), nil, 24},
	{demoBooking25, slotY8, false, 2, "Goran Stevanović", "demo-guest-25", strPtr("@gorans"), []string{"Riverside studio"}, 25},
	// ── 31–60 days ago — the previous 30-day window. ──────────────────
	{demoBooking26, slotY8, false, 1, "Milica Radović", "demo-guest-26", strPtr("@milicar"), []string{"Downtown studio"}, 32},
	{demoBooking27, slotB6, false, 1, "Radovan Knežević", "demo-guest-27", strPtr("@radovank"), nil, 34},
	{demoBooking28, slotP5, false, 1, "Sofija Marić", "demo-guest-28", strPtr("@sofijam"), []string{"Take-home glaze kit"}, 36},
	{demoBooking29, slotY7, false, 1, "Todor Jovanović", "demo-guest-29", strPtr("@todorj"), []string{"Downtown studio"}, 38},
	{demoBooking30, slotB5, false, 1, "Anastasija Milošević", "demo-guest-30", strPtr("@anastasijam"), nil, 40},
	{demoBooking31, slotY6, false, 2, "Lazar Gagić", "demo-guest-31", strPtr("@lazarg"), []string{"Riverside studio"}, 42},
	{demoBooking32, slotP4, false, 1, "Vesna Protić", "demo-guest-32", strPtr("@vesnap"), []string{"Photo of your piece"}, 44},
	{demoBooking33, slotB3, false, 1, "Bojan Janković", "demo-guest-33", strPtr("@bojanj"), nil, 46},
	{demoBooking34, slotY5, false, 1, "Ivana Dragović", "demo-guest-34", strPtr("@ivanad"), []string{"Downtown studio"}, 48},
	{demoBooking35, slotB6, true, 1, "Miloš Arsić", "demo-guest-35", strPtr("@milosa"), nil, 50},
	{demoBooking36, slotP5, false, 2, "Jelena Cvetanović", "demo-guest-36", strPtr("@jelenac"), []string{"Bring a friend (+1 seat)"}, 52},
	{demoBooking37, slotY8, false, 1, "Nemanja Kostić", "demo-guest-37", strPtr("@nemanjak"), []string{"Riverside studio"}, 54},
	{demoBooking38, slotB3, false, 1, "Milica Zorić", "demo-guest-38", strPtr("@milicaz"), nil, 56},
	{demoBooking39, slotY7, false, 1, "Aleksa Mitrović", "demo-guest-39", strPtr("@aleksam"), []string{"Downtown studio"}, 58},
	{demoBooking40, slotP4, false, 1, "Tamara Bogdanović", "demo-guest-40", strPtr("@tamarab"), []string{"Take-home glaze kit"}, 60},
}

// buildDemoSlots resolves the templates against now. bookedCount is
// seeded as a plain number rather than derived from the booking rows:
// the demo intentionally shows realistic fill levels without needing a
// booking row per seat, and because the account is read-only these
// counters never drift.
func buildDemoSlots(now time.Time) []TimeSlotRow {
	out := make([]TimeSlotRow, 0, len(demoSlotTemplates))
	for _, t := range demoSlotTemplates {
		startsAt := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day(),
			t.Hour, 0, 0, 0, time.UTC).AddDate(0, 0, t.DayOffset+1)
		out = append(out, TimeSlotRow{
			ID: t.ID, ServiceID: t.ServiceID, StartsAt: startsAt,
			DurationMinutes: t.DurationMinutes, Capacity: t.Capacity,
			BookedCount: t.BookedCount, Price: t.Price,
		})
	}
	return out
}

// buildDemoBookings resolves the templates against now and the freshly
// built slots. Tokens are random per run and every row carries
// manage_token_expires_at = slot start + 24h (the production rule):
// bookings on past slots are born expired, upcoming ones usable — no
// row recreates the legacy NULL-expiry state migration 0014 removed.
func buildDemoBookings(now time.Time, slots []TimeSlotRow) []BookingRow {
	startsAt := map[string]time.Time{}
	for _, s := range slots {
		startsAt[s.ID] = s.StartsAt
	}
	out := make([]BookingRow, 0, len(demoBookingTemplates))
	for _, t := range demoBookingTemplates {
		status := "confirmed"
		if t.Cancelled {
			status = "cancelled"
		}
		expiresAt := now.Add(manageTokenGracePeriod)
		if start, ok := startsAt[t.TimeSlotID]; ok {
			expiresAt = start.Add(manageTokenGracePeriod)
		}
		token := newManageToken()
		out = append(out, BookingRow{
			ID: t.ID, TimeSlotID: t.TimeSlotID, Status: status, Seats: t.Seats,
			GuestName: t.GuestName, GuestMessenger: "telegram", GuestMessengerID: t.GuestMessengerID,
			GuestMessengerLogin: t.GuestLogin, GuestLocale: contracts.DefaultLocale,
			ManageToken: token, SelectedOptions: t.SelectedOptions,
			CreatedAt:            now.Add(-time.Duration(t.DaysAgo) * 24 * time.Hour),
			ManageTokenExpiresAt: &expiresAt,
		})
	}
	return out
}

// SeedDemo seeds / refreshes the read-only demo organizer. Idempotent:
// safe to run repeatedly, intended to run on the QStash schedule so
// demo slot times stay in the future. Re-running upserts the organizer
// and services by their deterministic ids, then replaces slots and
// bookings wholesale.
func SeedDemo(ctx context.Context, now time.Time) error {
	slots := buildDemoSlots(now)
	slotBookings := buildDemoBookings(now, slots)
	demoServiceIDs := []string{}
	for _, s := range demoServices {
		demoServiceIDs = append(demoServiceIDs, s.ID)
	}

	tx, err := Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background()) //nolint

	_, err = tx.Exec(ctx, `
		INSERT INTO organizers (id, slug, name, messenger, messenger_id, timezone, language, description, photo_url, location, contact)
		VALUES ($1::uuid, $2, $3, $4::messenger_kind, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (id) DO UPDATE SET
			slug = $2, name = $3, timezone = $6, language = $7, description = $8,
			photo_url = $9, location = $10, contact = $11`,
		contracts.DemoOrganizerID, contracts.DemoOrganizerSlug, "Studio Demo",
		"telegram", demoMessengerID, demoTimezone, contracts.DefaultLocale,
		demoOrganizer.Description, demoOrganizer.PhotoURL, demoOrganizer.Location, demoOrganizer.Contact)
	if err != nil {
		return err
	}

	for _, s := range demoServices {
		_, err = tx.Exec(ctx, `
			INSERT INTO services (id, organizer_id, title, description, photo_url, location, contact,
				default_price, default_capacity, default_duration_minutes, max_seats_per_booking,
				options, options_select_mode)
			VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::options_select_mode)
			ON CONFLICT (id) DO UPDATE SET
				title = $3, description = $4, photo_url = $5, location = $6, contact = $7,
				default_price = $8, default_capacity = $9, default_duration_minutes = $10,
				max_seats_per_booking = $11,
				options = $12, options_select_mode = $13::options_select_mode`,
			s.ID, contracts.DemoOrganizerID, s.Title, s.Description, s.PhotoURL, s.Location, s.Contact,
			s.DefaultPrice, s.DefaultCapacity, s.DefaultDurationMinutes, s.MaxSeatsPerBooking,
			nullableSlice(s.Options), s.OptionsSelectMode)
		if err != nil {
			return err
		}
	}

	// Replace slots (and their bookings) wholesale.
	_, err = tx.Exec(ctx, `DELETE FROM bookings WHERE time_slot_id IN (
		SELECT id FROM time_slots WHERE service_id = ANY($1))`, demoServiceIDs)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `DELETE FROM time_slots WHERE service_id = ANY($1)`, demoServiceIDs)
	if err != nil {
		return err
	}

	for _, slot := range slots {
		_, err = tx.Exec(ctx, `
			INSERT INTO time_slots (id, service_id, starts_at, duration_minutes, capacity, booked_count, price)
			VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)`,
			slot.ID, slot.ServiceID, slot.StartsAt, slot.DurationMinutes, slot.Capacity, slot.BookedCount, slot.Price)
		if err != nil {
			return err
		}
	}

	for _, b := range slotBookings {
		_, err = tx.Exec(ctx, `
		INSERT INTO bookings (id, time_slot_id, status, seats, guest_name, guest_messenger, guest_messenger_id,
		guest_messenger_login, guest_locale, manage_token, manage_token_hash, selected_options, manage_token_expires_at)
		VALUES ($1::uuid, $2::uuid, $3::booking_status, $4, $5, $6::messenger_kind, $7, $8, $9, $10, $11, $12, $13)`,
			b.ID, b.TimeSlotID, b.Status, b.Seats, b.GuestName, b.GuestMessenger, b.GuestMessengerID,
			b.GuestMessengerLogin, b.GuestLocale, b.ManageToken, HashManageToken(b.ManageToken), nullableSlice(b.SelectedOptions), b.ManageTokenExpiresAt)
		if err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}
