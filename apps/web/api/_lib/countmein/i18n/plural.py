"""CLDR cardinal plural categories for the app locales, integer inputs
only (all ICU plurals in the translations are over seat counts)."""


def plural_category(locale: str, n: int) -> str:
    if locale == "ru":
        m10, m100 = n % 10, n % 100
        if m10 == 1 and m100 != 11:
            return "one"
        if 2 <= m10 <= 4 and not (12 <= m100 <= 14):
            return "few"
        return "many"
    if locale == "ar":
        if n == 0:
            return "zero"
        if n == 1:
            return "one"
        if n == 2:
            return "two"
        m100 = n % 100
        if 3 <= m100 <= 10:
            return "few"
        if 11 <= m100 <= 99:
            return "many"
        return "other"
    if locale in ("fr", "pt"):
        # fr/pt: 0 and 1 are singular ("one").
        if n in (0, 1):
            return "one"
        return "other"
    if locale == "ja":
        return "other"
    # en, de, es
    if n == 1:
        return "one"
    return "other"
