package jobs

import (
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	gen "countmein/pkg/api/gen"
	"countmein/pkg/contracts"
	"countmein/pkg/db"
	"countmein/pkg/i18n"
)

// the rendering side of every notification. Telegram parses these
// strings as HTML — an unescaped & or < in a guest name is a 400 "can't
// parse entities" and the message is never delivered. Locale selection
// (ADR-011) and the organizer-timezone rule are contracts, not
// preferences: the guest's confirmation must show the same wall clock as
// the public page they booked from.

var updateGoldens = flag.Bool("update-goldens", false, "rewrite notification golden files")

// testView — a BookingView with every user-supplied field populated:
// names, titles, option labels, prices, location and contact all come
// from guest/organizer input and must survive escaping.
func testView() BookingView {
	login := "@anne"
	loc := "Studio 5 <Main Hall>"
	contact := "+381 60 123 4567"
	slotPrice := "15 EUR"
	return BookingView{
		Booking: db.BookingRow{
			ID:                  "01930000-0000-7000-8000-0000000000b1",
			TimeSlotID:          "01930000-0000-7000-8000-0000000000s1",
			Status:              "confirmed",
			Seats:               2,
			GuestName:           `Anne & Co <"anne">`,
			GuestMessenger:      "telegram",
			GuestMessengerID:    "7001",
			GuestMessengerLogin: &login,
			GuestLocale:         "ru",
			ManageToken:         "tok-abc123",
			SelectedOptions:     []string{"Mat rental", "Towel +2€"},
		},
		Slot: db.TimeSlotRow{
			ID:              "01930000-0000-7000-8000-0000000000s1",
			ServiceID:       "01930000-0000-7000-8000-0000000000v1",
			StartsAt:        time.Date(2026, 7, 25, 7, 0, 0, 0, mustLoc("Europe/Belgrade")),
			DurationMinutes: 60,
			Capacity:        10,
			BookedCount:     7,
			Price:           &slotPrice,
		},
		Service: db.ServiceRow{
			ID:                 "01930000-0000-7000-8000-0000000000v1",
			OrganizerID:        "01930000-0000-7000-8000-0000000000o1",
			Title:              `Yoga <Morning> Flow`,
			DefaultPrice:       "12 EUR",
			MaxSeatsPerBooking: 4,
			Location:           &loc,
			Contact:            &contact,
		},
		Organizer: db.OrganizerRow{
			ID:          "01930000-0000-7000-8000-0000000000o1",
			Slug:        "test-org",
			Name:        `Mira & Yoga`,
			Messenger:   "telegram",
			MessengerID: "6001",
			Timezone:    "Europe/Belgrade",
			Language:    "de",
		},
	}
}

func mustLoc(tz string) *time.Location {
	loc, err := time.LoadLocation(tz)
	if err != nil {
		panic(err)
	}
	return loc
}

// ── EscapeHTML ────────────────────────────────────────────────────────────────

func TestEscapeHTML(t *testing.T) {
	// Expected values are composed from the entity vars because literal
	// HTML entities in this source get mangled by the authoring pipeline
	// (same reason templates.go builds them from parts).
	cases := []struct{ in, want string }{
		{`<Anne & Co>`, entityLT + "Anne " + entityAmp + " Co" + entityGT},
		{`'; DROP TABLE bookings; --`, entityApos + "; DROP TABLE bookings; --"},
		{`she said "ok"`, `she said ` + entityQuot + "ok" + entityQuot},
		{`plain text`, "plain text"},
		{`emoji 🔑 stays`, "emoji 🔑 stays"},
		{`<b>bold</b>`, entityLT + "b" + entityGT + "bold" + entityLT + "/b" + entityGT},
	}
	for _, c := range cases {
		if got := EscapeHTML(c.in); got != c.want {
			t.Errorf("EscapeHTML(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// The regression behind this test: a guest called "Anne & Co" used to break
// Telegram's entity parser. Every user-supplied value in a rendered
// message must go through EscapeHTML — this pins the composed output,
// not just the helper.
func TestRenderedMessagesEscapeUserInput(t *testing.T) {
	view := testView()
	messages := map[string]Message{
		"createdOrganizer":   BookingCreatedForOrganizer(view, "https://example.com/cabinet", "en"),
		"createdGuest":       BookingCreatedForGuest(view, "https://example.com/booking/tok", "en"),
		"cancelledOrganizer": BookingCancelledForOrganizer(view, "https://example.com/cabinet", "en"),
		"cancelledGuest":     BookingCancelledForGuest(view, "https://example.com/org", "en"),
	}
	for name, msg := range messages {
		if strings.Contains(msg.Text, "& Co") || strings.Contains(msg.Text, "<anne>") {
			t.Errorf("%s: message contains unescaped user input:\n%s", name, msg.Text)
		}
	}
	// The two organizer-facing messages lead with the guest; the escaped
	// form must appear there.
	escapedName := "Anne " + entityAmp + " Co"
	for _, name := range []string{"createdOrganizer", "cancelledOrganizer"} {
		if !strings.Contains(messages[name].Text, escapedName) {
			t.Errorf("%s: must carry the escaped guest name:\n%s", name, messages[name].Text)
		}
	}
}

// ── NotificationLocale (ADR-011) ──────────────────────────────────────────────

func TestNotificationLocale(t *testing.T) {
	view := testView() // organizer.Language = "de", booking.GuestLocale = "ru"

	if got := NotificationLocale(gen.NotificationRecipientOrganizer, view); got != "de" {
		t.Errorf("organizer locale = %q, want their stored language %q", got, "de")
	}
	if got := NotificationLocale(gen.NotificationRecipientGuest, view); got != "ru" {
		t.Errorf("guest locale = %q, want the captured booking locale %q", got, "ru")
	}

	// Free-text columns must not break rendering — garbage clamps to en.
	view.Organizer.Language = "klingon"
	if got := NotificationLocale(gen.NotificationRecipientOrganizer, view); got != contracts.DefaultLocale {
		t.Errorf("garbage organizer language must clamp to %q, got %q", contracts.DefaultLocale, got)
	}
	view.Booking.GuestLocale = ""
	if got := NotificationLocale(gen.NotificationRecipientGuest, view); got != contracts.DefaultLocale {
		t.Errorf("empty guest locale must clamp to %q, got %q", contracts.DefaultLocale, got)
	}
}

// ── formatInstant: organizer's timezone, locale labels ───────────────────────

// The same instant renders the same wall clock for every locale — only
// the labels move. A guest in LA must see the Belgrade time the public
// page showed (the confirmation may not disagree with the page).
func TestFormatInstantAlwaysInOrganizerTimezone(t *testing.T) {
	instant := time.Date(2026, 7, 25, 7, 0, 0, 0, mustLoc("Europe/Belgrade")) // 05:00 UTC

	en := formatInstant(instant, "Europe/Belgrade", "en")
	ru := formatInstant(instant, "Europe/Belgrade", "ru")
	if !strings.Contains(en, "07:00") || !strings.Contains(ru, "07:00") {
		t.Errorf("wall clock must be Belgrade 07:00 in every locale, got en=%q ru=%q", en, ru)
	}
	if en == ru {
		t.Errorf("labels must differ per locale, both rendered %q", en)
	}

	// The zone is the organizer's, never the recipient's: rendering with
	// a different zone would change the printed time.
	la := formatInstant(instant, "America/Los_Angeles", "en")
	if strings.Contains(la, "07:00") {
		t.Errorf("LA rendering must show LA wall clock, got %q", la)
	}

	// An unknown timezone falls back to UTC, not to a panic.
	if got := formatInstant(instant, "Mars/Olympus", "en"); got == "" {
		t.Error("unknown timezone must render as UTC, not empty")
	}
	// An unknown locale falls back to the default calendar.
	if got := formatInstant(instant, "Europe/Belgrade", "xx"); !strings.Contains(got, "07:00") {
		t.Errorf("unknown locale must fall back to %q, got %q", contracts.DefaultLocale, got)
	}
}

// ── bookingLines: price precedence and option/empty sections ──────────────────

func TestBookingLinesPricePrecedence(t *testing.T) {
	// Slot override wins over the service default.
	view := testView() // slot price "15 EUR", service default "12 EUR"
	lines := bookingLines(view, "en")
	if !containsLine(lines, "💰 15 EUR") {
		t.Errorf("slot price override must win, got %v", lines)
	}

	// No override → the service default.
	view.Slot.Price = nil
	lines = bookingLines(view, "en")
	if !containsLine(lines, "💰 12 EUR") {
		t.Errorf("service default price must render, got %v", lines)
	}

	// Both empty → no price line at all.
	view.Service.DefaultPrice = ""
	lines = bookingLines(view, "en")
	for _, l := range lines {
		if strings.HasPrefix(l, "💰") {
			t.Errorf("empty price must hide the section, got %v", lines)
		}
	}
}

func TestBookingLinesOptionsAndSeats(t *testing.T) {
	view := testView()
	lines := bookingLines(view, "en")
	if !containsLine(lines, "🔖 Mat rental, Towel +2€") {
		t.Errorf("selected options must render joined, got %v", lines)
	}
	// The seats line is ICU-pluralized per locale; pin that it exists and
	// carries the count.
	joined := strings.Join(lines, "\n")
	if !strings.Contains(joined, "2") {
		t.Errorf("seats count must appear in the lines, got %q", joined)
	}

	// No options → the section is hidden.
	view.Booking.SelectedOptions = nil
	lines = bookingLines(view, "en")
	for _, l := range lines {
		if strings.HasPrefix(l, "🔖") {
			t.Errorf("empty options must hide the section, got %v", lines)
		}
	}
}

// ── organizerDetailLines: service-over-organizer (docs/domain.md) ─────────────

func TestOrganizerDetailLinesOverride(t *testing.T) {
	view := testView()
	lines := organizerDetailLines(view)
	joined := strings.Join(lines, "\n")
	wantLoc := "Studio 5 " + entityLT + "Main Hall" + entityGT
	if !strings.Contains(joined, wantLoc) {
		t.Errorf("service location must win (and be escaped), got %v", lines)
	}

	// No service values → the organizer's own.
	view.Service.Location = nil
	view.Service.Contact = nil
	orgLoc := "Belgrade, Dorćol"
	orgContact := "@mira_yoga"
	view.Organizer.Location = &orgLoc
	view.Organizer.Contact = &orgContact
	lines = organizerDetailLines(view)
	if !containsLine(lines, "📍 "+orgLoc) || !containsLine(lines, "☎️ "+orgContact) {
		t.Errorf("organizer fallback must render, got %v", lines)
	}

	// Both empty → no lines at all.
	view.Organizer.Location = nil
	view.Organizer.Contact = nil
	if lines := organizerDetailLines(view); len(lines) != 0 {
		t.Errorf("empty location+contact must hide both sections, got %v", lines)
	}
}

// ── full vs stillFree ─────────────────────────────────────────────────────────

func TestBookingCreatedForOrganizerFullVsStillFree(t *testing.T) {
	view := testView() // capacity 10, booked 7 → 3 left
	msg := BookingCreatedForOrganizer(view, "https://example.com/cabinet", "en")
	if !strings.Contains(msg.Text, "3") {
		t.Errorf("stillFree must carry the remaining count, got:\n%s", msg.Text)
	}

	view.Slot.BookedCount = 10 // full
	msg = BookingCreatedForOrganizer(view, "https://example.com/cabinet", "en")
	full := i18nNotif("en", "createdOrganizer", "full", nil)
	if full == "" || !strings.Contains(msg.Text, full) {
		t.Errorf("sold-out slot must render the full message (%q), got:\n%s", full, msg.Text)
	}
	if strings.Contains(msg.Text, i18nNotif("en", "createdOrganizer", "stillFree", map[string]any{"count": 0})) {
		t.Errorf("full slot must not render stillFree, got:\n%s", msg.Text)
	}
}

func TestMessageButtonsCarryURLs(t *testing.T) {
	view := testView()
	if msg := BookingCreatedForOrganizer(view, "https://example.com/cabinet", "en"); msg.Button == nil || msg.Button.URL != "https://example.com/cabinet" {
		t.Errorf("organizer button must open the cabinet URL, got %+v", msg.Button)
	}
	if msg := BookingCreatedForGuest(view, "https://example.com/booking/tok", "en"); msg.Button == nil || msg.Button.URL != "https://example.com/booking/tok" {
		t.Errorf("guest button must open the manage URL, got %+v", msg.Button)
	}
}

// ── golden files: 8 locales × 4 templates ─────────────────────────────────────

// Every notification template renders a golden per locale — a change to
// copy, escaping, section order or plural handling in ANY locale shows
// up as a diff. Regenerate with: go test ./pkg/jobs -run Golden -update-goldens
func TestGoldenNotifications(t *testing.T) {
	view := testView()
	for _, locale := range contracts.Locales {
		t.Run(locale, func(t *testing.T) {
			got := strings.Join([]string{
				"## createdOrganizer",
				renderMessage(BookingCreatedForOrganizer(view, "https://example.com/cabinet", locale)),
				"## createdGuest",
				renderMessage(BookingCreatedForGuest(view, "https://example.com/booking/tok-abc123", locale)),
				"## cancelledOrganizer",
				renderMessage(BookingCancelledForOrganizer(view, "https://example.com/cabinet", locale)),
				"## cancelledGuest",
				renderMessage(BookingCancelledForGuest(view, "https://example.com/test-org", locale)),
			}, "\n")

			path := filepath.Join("testdata", "notifications", locale+".golden")
			if *updateGoldens {
				if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, []byte(got), 0o644); err != nil {
					t.Fatal(err)
				}
				return
			}
			want, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("missing golden %s (run: go test ./pkg/jobs -run Golden -update-goldens): %v", path, err)
			}
			if string(want) != got {
				t.Errorf("notification output for %q changed; diff the golden file %s (or regenerate with -update-goldens):\n--- golden\n%s\n--- now\n%s",
					locale, path, string(want), got)
			}
		})
	}
}

func renderMessage(m Message) string {
	out := m.Text
	if m.Button != nil {
		out += "\n[button] " + m.Button.Text + " → " + m.Button.URL
	}
	return out
}

func containsLine(lines []string, want string) bool {
	for _, l := range lines {
		if l == want {
			return true
		}
	}
	return false
}

func i18nNotif(locale, section, key string, params map[string]any) string {
	return i18n.Notif(locale, section, key, params)
}
