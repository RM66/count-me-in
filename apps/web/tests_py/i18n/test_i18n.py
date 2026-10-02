"""The i18n tests: the ICU
subset renderer and the api-errors/notifications lookup with fallbacks.
"""

from countmein.contracts.constants_gen import DEFAULT_LOCALE, LOCALES
from countmein.contracts.domain import match_locale
from countmein.i18n import api_error, format_message, notif, plural_category
from countmein.i18n.locale import detect_locale


def test_format_placeholder():
    assert format_message("Hello {name}", "en", {"name": "Ada"}) == "Hello Ada"


def test_format_missing_param_renders_as_is():
    assert format_message("Hello {name}", "en", {}) == "Hello {name}"


def test_format_plural_exact_match_wins():
    msg = "{count, plural, =1 {# seat} other {# seats}}"
    assert format_message(msg, "en", {"count": 1}) == "1 seat"
    assert format_message(msg, "en", {"count": 5}) == "5 seats"


def test_format_plural_ru_categories():
    msg = "{count, plural, one {# место} few {# места} many {# мест} other {# мест}}"
    assert format_message(msg, "ru", {"count": 1}) == "1 место"
    assert format_message(msg, "ru", {"count": 3}) == "3 места"
    assert format_message(msg, "ru", {"count": 11}) == "11 мест"


def test_format_plural_ar_categories():
    msg = "{count, plural, zero {нет} one {# } two {два} few {неск} many {мн} other {др}}"
    assert format_message(msg, "ar", {"count": 0}) == "нет"
    assert format_message(msg, "ar", {"count": 1}) == "1 "
    assert format_message(msg, "ar", {"count": 2}) == "два"
    assert format_message(msg, "ar", {"count": 5}) == "неск"
    assert format_message(msg, "ar", {"count": 50}) == "мн"
    assert format_message(msg, "ar", {"count": 200}) == "др"


def test_format_plural_fr_pt_zero_is_one():
    msg = "{count, plural, one {# place} other {# places}}"
    assert format_message(msg, "fr", {"count": 0}) == "0 place"
    assert format_message(msg, "pt", {"count": 1}) == "1 place"
    assert format_message(msg, "fr", {"count": 2}) == "2 places"


def test_format_plural_ja_always_other():
    msg = "{count, plural, other {# 席}}"
    assert format_message(msg, "ja", {"count": 1}) == "1 席"


def test_format_nested_placeholder_in_clause():
    msg = "{count, plural, other {{name} has #}}"
    assert format_message(msg, "en", {"count": 2, "name": "Ada"}) == "Ada has 2"


def test_plural_category_table():
    assert plural_category("en", 1) == "one"
    assert plural_category("en", 0) == "other"
    assert plural_category("de", 1) == "one"
    assert plural_category("ru", 21) == "one"
    assert plural_category("ru", 12) == "many"
    assert plural_category("ru", 14) == "many"
    assert plural_category("ru", 22) == "few"


def test_api_error_falls_back_to_english_then_key():
    assert api_error("en", "soldOut") != ""
    assert api_error("xx-unknown", "soldOut") == api_error("en", "soldOut")
    assert api_error("en", "noSuchKey") == "noSuchKey"


def test_api_error_localized():
    assert api_error("ru", "soldOut") != api_error("en", "soldOut")


def test_api_error_params():
    msg = api_error("en", "seatsLeftOnSession", {"count": 3})
    assert "3" in msg


def test_notif_top_level_and_sections():
    assert notif("en", "", "seats", {"count": 1}) == "1 seat"
    assert notif("en", "createdOrganizer", "title") != ""
    # Fallback chain: unknown locale → English → "section.key".
    assert notif("xx", "", "seats", {"count": 1}) == "1 seat"
    assert notif("en", "", "nope") == "nope"
    assert notif("en", "nosec", "nope") == "nosec.nope"


def test_detect_locale_cookie_wins():
    assert detect_locale({"NEXT_LOCALE": "ru"}, "en") == "ru"
    assert detect_locale({"NEXT_LOCALE": "bogus"}, "de-DE,ru;q=0.9") == "de"
    assert detect_locale({}, "ru-RU,ru;q=0.9,en;q=0.8") == "ru"
    assert detect_locale({}, "") == DEFAULT_LOCALE


def test_match_locale_primary_subtag():
    assert match_locale("de-CH,fr;q=0.8") == "de"
    assert match_locale("xx-YY,es;q=0.5") == "es"
    assert match_locale("") is None


def test_every_locale_has_api_errors():
    for locale in LOCALES:
        assert api_error(locale, "invalidInput"), locale
