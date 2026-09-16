package contracts

type BookingStatus string

const (
	BookingConfirmed BookingStatus = "confirmed"
	BookingCancelled BookingStatus = "cancelled"
)

type Messenger string

const MessengerTelegram Messenger = "telegram"

type OptionsSelectMode string

const (
	OptionsSingle OptionsSelectMode = "single"
	OptionsMulti  OptionsSelectMode = "multi"
)

// Locales — order matters for the language switcher (default first,
// then endonyms alphabetically); mirrored from packages/contracts.
var Locales = []string{"en", "de", "es", "fr", "pt", "ru", "ar", "ja"}

const DefaultLocale = "en"

func IsAppLocale(v string) bool {
	for _, l := range Locales {
		if v == l {
			return true
		}
	}
	return false
}

// LocaleDirection for the document root.
func LocaleDirection(locale string) string {
	if locale == "ar" {
		return "rtl"
	}
	return "ltr"
}
