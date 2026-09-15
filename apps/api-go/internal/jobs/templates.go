package jobs

import (
	"strconv"
	"strings"
	"time"

	"api-go/internal/contracts"
	"api-go/internal/db"
	"api-go/internal/i18n"
)

// The rendering side of every notification, as Telegram HTML.
//
// Language (ADR-011): every message renders in one of the app locales —
// the organizer reads their own organizers.language, the guest the
// guestLocale captured at booking time, both clamped to the supported
// set (free-text columns must not break rendering).
//
// Times always render in the organizer's timezone, for the guest too: a
// slot is authored as a wall-clock reading in that zone and it is the
// one printed on the public page the guest booked from; re-rendering
// in another zone would make the confirmation disagree with the page.
// Only the labels follow the locale, never the zone.
//
// HTML tags live here in code, not in the ICU messages: use-intl reads
// <tag> pairs as rich-text placeholders, the wrong tool for Telegram
// HTML. Only user-supplied values are escaped — tags composed here are
// trusted markup.

// Message is a rendered notification.
type Message struct {
	Text   string
	Button *MessageButton
}

// BookingView — the raw rows a notification needs (two read models over
// one chain: this one keeps manageToken, chat ids and timezones).
type BookingView struct {
	Booking   db.BookingRow
	Slot      db.TimeSlotRow
	Service   db.ServiceRow
	Organizer db.OrganizerRow
}

// escapeAmp etc. are assembled from parts because literal HTML entities
// in this source get mangled by the authoring pipeline.
var (
	entityAmp  = "&" + "amp;"
	entityLT   = "&" + "lt;"
	entityGT   = "&" + "gt;"
	entityQuot = "&" + "quot;"
	entityApos = "&" + "#" + "39;"
)

// EscapeHTML escapes the five characters that would otherwise be read
// as markup. Every interpolated value goes through this: guest names,
// titles and option labels are user input, and an unescaped < turns
// the whole message into a 400 can't parse entities — a delivery
// failure caused by a guest called "Anne & Co".
func EscapeHTML(value string) string {
	r := strings.NewReplacer(
		"&", entityAmp,
		"<", entityLT,
		">", entityGT,
		"\"", entityQuot,
		"'", entityApos,
	)
	return r.Replace(value)
}

// NotificationLocale — the locale a recipient reads: the organizer's
// own language, the guest's captured booking locale.
func NotificationLocale(recipient contracts.NotificationRecipient, view BookingView) string {
	stored := view.Booking.GuestLocale
	if recipient == contracts.RecipientOrganizer {
		stored = view.Organizer.Language
	}
	if contracts.IsAppLocale(stored) {
		return stored
	}
	return contracts.DefaultLocale
}

// Per-locale short weekday and month names for formatInstant — Go has
// no localized time formatting; these cover the app's eight locales
// (approximate ICU shapes; message text only, not a wire contract).
type localeCalendar struct {
	weekdays [7]string // Sunday-first
	months   [12]string
	pattern  string
}

var calendars = map[string]localeCalendar{
	"en": {
		weekdays: [7]string{"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"},
		months:   [12]string{"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"},
		pattern:  "{wd}, {mo} {d}, {y}, {hh}:{mm}",
	},
	"de": {
		weekdays: [7]string{"So.", "Mo.", "Di.", "Mi.", "Do.", "Fr.", "Sa."},
		months:   [12]string{"Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez."},
		pattern:  "{wd}, {d}. {mo} {y}, {hh}:{mm}",
	},
	"es": {
		weekdays: [7]string{"dom.", "lun.", "mar.", "mié.", "jue.", "vie.", "sáb."},
		months:   [12]string{"ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sept.", "oct.", "nov.", "dic."},
		pattern:  "{wd}, {d} {mo} {y}, {hh}:{mm}",
	},
	"fr": {
		weekdays: [7]string{"dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."},
		months:   [12]string{"janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."},
		pattern:  "{wd} {d} {mo} {y}, {hh}:{mm}",
	},
	"pt": {
		weekdays: [7]string{"dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."},
		months:   [12]string{"jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."},
		pattern:  "{wd}, {d} de {mo} de {y}, {hh}:{mm}",
	},
	"ru": {
		weekdays: [7]string{"вс", "пн", "вт", "ср", "чт", "пт", "сб"},
		months:   [12]string{"янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."},
		pattern:  "{wd}, {d} {mo} {y} г., {hh}:{mm}",
	},
	"ar": {
		weekdays: [7]string{"أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"},
		months:   [12]string{"يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"},
		pattern:  "{wd}، {d} {mo} {y}، {hh}:{mm}",
	},
	"ja": {
		weekdays: [7]string{"日", "月", "火", "水", "木", "金", "土"},
		months:   [12]string{"1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"},
		pattern:  "{y}/{mo}/{d}({wd}) {hh}:{mm}",
	},
}

// formatInstant renders a slot start as read in `timezone`, labels in
// `locale` ("Sat, 25 Jul 2026, 07:00"-shaped, per-locale).
func formatInstant(t time.Time, timezone, locale string) string {
	calendar, ok := calendars[locale]
	if !ok {
		calendar = calendars[contracts.DefaultLocale]
	}
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		loc = time.UTC
	}
	tt := t.In(loc)
	out := calendar.pattern
	out = strings.ReplaceAll(out, "{wd}", calendar.weekdays[int(tt.Weekday())])
	out = strings.ReplaceAll(out, "{mo}", calendar.months[int(tt.Month())-1])
	out = strings.ReplaceAll(out, "{d}", strconv.Itoa(tt.Day()))
	out = strings.ReplaceAll(out, "{y}", strconv.Itoa(tt.Year()))
	out = strings.ReplaceAll(out, "{hh}", pad2(tt.Hour()))
	out = strings.ReplaceAll(out, "{mm}", pad2(tt.Minute()))
	return out
}

func pad2(v int) string {
	s := strconv.Itoa(v)
	if len(s) < 2 {
		return "0" + s
	}
	return s
}

// bookingLines — what, when, how many: the lines both audiences need,
// shared so a change to how a booking is described cannot land in the
// guest's message and be forgotten in the organizer's.
func bookingLines(view BookingView, locale string) []string {
	lines := []string{
		"📌 <b>" + EscapeHTML(view.Service.Title) + "</b>",
		"🗓 " + EscapeHTML(formatInstant(view.Slot.StartsAt, view.Organizer.Timezone, locale)),
		"👥 " + i18n.Notif(locale, "", "seats", map[string]any{"count": view.Booking.Seats}),
	}
	if len(view.Booking.SelectedOptions) > 0 {
		lines = append(lines, "🔖 "+EscapeHTML(strings.Join(view.Booking.SelectedOptions, ", ")))
	}
	if price := contracts.SlotPrice(view.Slot.Price, view.Service.DefaultPrice); price != "" {
		lines = append(lines, "💰 "+EscapeHTML(price))
	}
	return lines
}

// guestContactLine — how the organizer can reach the guest, when
// Telegram exposes a handle.
func guestContactLine(view BookingView) string {
	if view.Booking.GuestMessengerLogin != nil {
		return "👤 " + EscapeHTML(view.Booking.GuestName) + " (" + EscapeHTML(*view.Booking.GuestMessengerLogin) + ")"
	}
	return "👤 " + EscapeHTML(view.Booking.GuestName)
}

// organizerDetailLines — where and how to reach the organizer;
// service value wins (docs/domain.md).
func organizerDetailLines(view BookingView) []string {
	var lines []string
	if location := contracts.EffectiveLocation(view.Service.Location, view.Organizer.Location); location != nil {
		lines = append(lines, "📍 "+EscapeHTML(*location))
	}
	if contact := contracts.EffectiveContact(view.Service.Contact, view.Organizer.Contact); contact != nil {
		lines = append(lines, "☎️ "+EscapeHTML(*contact))
	}
	return lines
}

func joinLines(parts ...string) string { return strings.Join(parts, "\n") }

// BookingCreatedForOrganizer — to the organizer: someone just booked.
// Leads with the guest because that is the new information; the
// remaining-seats line makes the message worth reading at a glance.
func BookingCreatedForOrganizer(view BookingView, cabinetURL, locale string) Message {
	t := func(key string, params map[string]any) string {
		return i18n.Notif(locale, "createdOrganizer", key, params)
	}
	left := contracts.SeatsLeft(view.Slot.Capacity, view.Slot.BookedCount)

	var tail string
	if left == 0 {
		tail = t("full", nil)
	} else {
		tail = t("stillFree", map[string]any{"count": left})
	}
	text := joinLines(
		"🎉 <b>"+t("title", nil)+"</b>",
		"",
		guestContactLine(view),
		joinLines(bookingLines(view, locale)...),
		"",
		tail,
	)
	buttonText := t("button", nil)
	return Message{Text: text, Button: &MessageButton{Text: buttonText, URL: cabinetURL}}
}

// BookingCreatedForGuest — your booking is confirmed, and here is how
// to manage it.
func BookingCreatedForGuest(view BookingView, manageURL, locale string) Message {
	t := func(key string, params map[string]any) string { return i18n.Notif(locale, "createdGuest", key, params) }
	text := joinLines(
		"✅ <b>"+t("title", nil)+"</b> "+t("withName", map[string]any{"name": EscapeHTML(view.Organizer.Name)}),
		"",
		joinLines(bookingLines(view, locale)...),
		joinLines(organizerDetailLines(view)...),
		"",
		t("footer", nil),
	)
	buttonText := t("button", nil)
	return Message{Text: text, Button: &MessageButton{Text: buttonText, URL: manageURL}}
}

// BookingCancelledForOrganizer — the guest cancelled, the seats are back.
func BookingCancelledForOrganizer(view BookingView, cabinetURL, locale string) Message {
	t := func(key string, params map[string]any) string {
		return i18n.Notif(locale, "cancelledOrganizer", key, params)
	}
	text := joinLines(
		"❌ <b>"+t("title", nil)+"</b>",
		"",
		guestContactLine(view),
		joinLines(bookingLines(view, locale)...),
		"",
		t("freed", map[string]any{"count": contracts.SeatsLeft(view.Slot.Capacity, view.Slot.BookedCount)}),
	)
	buttonText := t("button", nil)
	return Message{Text: text, Button: &MessageButton{Text: buttonText, URL: cabinetURL}}
}

// BookingCancelledForGuest — the organizer cancelled your booking.
// Carries the organizer's contact and a link back to their page: the
// guest did not choose this, so the message's job is to explain and
// offer the next step. No management link — the booking is cancelled.
func BookingCancelledForGuest(view BookingView, organizerURL, locale string) Message {
	t := func(key string, params map[string]any) string {
		return i18n.Notif(locale, "cancelledGuest", key, params)
	}
	text := joinLines(
		"❌ <b>"+t("title", nil)+"</b> "+t("byName", map[string]any{"name": EscapeHTML(view.Organizer.Name)}),
		"",
		joinLines(bookingLines(view, locale)...),
		joinLines(organizerDetailLines(view)...),
		"",
		t("footer", nil),
	)
	buttonText := t("button", nil)
	return Message{Text: text, Button: &MessageButton{Text: buttonText, URL: organizerURL}}
}
