package i18n

// CLDR cardinal plural categories for the app locales, integer inputs
// only (all ICU plurals in the translations are over seat counts).

func pluralCategory(locale string, n int64) string {
	switch locale {
	case "ru":
		m10, m100 := n%10, n%100
		switch {
		case m10 == 1 && m100 != 11:
			return "one"
		case m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14):
			return "few"
		default:
			return "many"
		}
	case "ar":
		switch {
		case n == 0:
			return "zero"
		case n == 1:
			return "one"
		case n == 2:
			return "two"
		}
		m100 := n % 100
		switch {
		case m100 >= 3 && m100 <= 10:
			return "few"
		case m100 >= 11 && m100 <= 99:
			return "many"
		default:
			return "other"
		}
	case "fr", "pt":
		// fr/pt: 0 and 1 are singular ("one").
		if n == 0 || n == 1 {
			return "one"
		}
		return "other"
	case "ja":
		return "other"
	default: // en, de, es
		if n == 1 {
			return "one"
		}
		return "other"
	}
}
