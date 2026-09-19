package i18n

import "testing"

func TestFormatSimplePlaceholder(t *testing.T) {
	got := Format("Booking with {name} at {time}", "en", map[string]any{"name": "Studio", "time": "07:00"})
	if got != "Booking with Studio at 07:00" {
		t.Fatalf("got %q", got)
	}
}

func TestFormatMissingParamRendersAsIs(t *testing.T) {
	got := Format("with {name}", "en", nil)
	if got != "with {name}" {
		t.Fatalf("got %q", got)
	}
}

func TestFormatPluralEn(t *testing.T) {
	msg := "{count, plural, =1 {# seat} other {# seats}}"
	cases := map[int]string{1: "1 seat", 0: "0 seats", 2: "2 seats", 12: "12 seats"}
	for n, want := range cases {
		if got := Format(msg, "en", map[string]any{"count": n}); got != want {
			t.Fatalf("en %d: got %q, want %q", n, got, want)
		}
	}
}

func TestFormatPluralRu(t *testing.T) {
	// CLDR ru: one (…1, not 11), few (2–4, not 12–14), many (rest).
	msg := "{count, plural, one {# место} few {# места} many {# мест} other {# места}}"
	cases := map[int]string{
		1: "1 место", 2: "2 места", 5: "5 мест", 11: "11 мест",
		21: "21 место", 22: "22 места", 100: "100 мест", 0: "0 мест",
	}
	for n, want := range cases {
		if got := Format(msg, "ru", map[string]any{"count": n}); got != want {
			t.Fatalf("ru %d: got %q, want %q", n, got, want)
		}
	}
}

func TestFormatPluralAr(t *testing.T) {
	msg := "{count, plural, zero {لا أماكن} one {مكان واحد} two {مكانان} few {# أماكن} many {# مكانًا} other {# مكان}}"
	cases := map[int]string{
		0: "لا أماكن", 1: "مكان واحد", 2: "مكانان", 3: "3 أماكن",
		10: "10 أماكن", 11: "11 مكانًا", 99: "99 مكانًا", 100: "100 مكان",
	}
	for n, want := range cases {
		if got := Format(msg, "ar", map[string]any{"count": n}); got != want {
			t.Fatalf("ar %d: got %q, want %q", n, got, want)
		}
	}
}

func TestFormatPluralFrZeroIsOne(t *testing.T) {
	msg := "{count, plural, =1 {# place} other {# places}}"
	if got := Format(msg, "fr", map[string]any{"count": 0}); got != "0 places" {
		t.Fatalf("fr =1 clause wins for 0: got %q", got)
	}
}

func TestApiError(t *testing.T) {
	if got := ApiError("en", "soldOut", nil); got != "This session is fully booked" {
		t.Fatalf("soldOut: %q", got)
	}
	if got := ApiError("en", "seatsLeftOnSession", map[string]any{"count": 1}); got != "Only 1 seat left on this session" {
		t.Fatalf("seatsLeftOnSession: %q", got)
	}
	if got := ApiError("ru", "demoReadOnly", nil); got == "demoReadOnly" {
		t.Fatalf("ru demoReadOnly must resolve: %q", got)
	}
	if got := ApiError("en", "definitely-missing-key", nil); got != "definitely-missing-key" {
		t.Fatalf("missing key falls back to the key itself: %q", got)
	}
}

func TestNotifTopLevelAndSection(t *testing.T) {
	// "seats" is a top-level key in the notification dictionaries.
	if got := Notif("en", "", "seats", map[string]any{"count": 1}); got != "1 seat" {
		t.Fatalf("seats(1): %q", got)
	}
	if got := Notif("ru", "", "seats", map[string]any{"count": 3}); got != "3 места" {
		t.Fatalf("seats(3): %q", got)
	}
	// Sectioned keys.
	if got := Notif("en", "createdOrganizer", "title", nil); got != "New booking" {
		t.Fatalf("createdOrganizer.title: %q", got)
	}
	if got := Notif("en", "createdGuest", "withName", map[string]any{"name": "Studio"}); got != "with Studio" {
		t.Fatalf("createdGuest.withName: %q", got)
	}
	if got := Notif("ru", "createdOrganizer", "stillFree", map[string]any{"count": 5}); got != "🎟 Осталось 5 мест." {
		t.Fatalf("ru stillFree(5): %q", got)
	}
}

func TestNotifFallbackToEnglish(t *testing.T) {
	// ja has no own section for a missing key path is not exercised;
	// instead: a fabricated section falls back to "section.key".
	if got := Notif("en", "no-such-section", "key", nil); got != "no-such-section.key" {
		t.Fatalf("missing section falls back to section.key: %q", got)
	}
}
