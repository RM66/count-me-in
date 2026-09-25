package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

const testBotToken = "123456789:TEST-BOT-TOKEN-abcdef"

// freshAuthDate is a current timestamp — the validator rejects widget
// payloads older than 24h (hasDataExpired in the TS validator), so
// fixtures must not use frozen historical dates.
func freshAuthDate() string {
	return strconv.FormatInt(time.Now().Unix(), 10)
}

func expiredAuthDate() string {
	return strconv.FormatInt(time.Now().Unix()-widgetDataValidAfter-3600, 10)
}

func futureAuthDate() string {
	return strconv.FormatInt(time.Now().Unix()+3600, 10)
}

// signWidget computes the Telegram widget hash independently of the
// production code path (same algorithm, hand-written here) so the
// test anchors the HMAC contract, not just itself. Values arrive
// stringified, like objectToAuthDataMap produces in the TS validator.
func signWidget(botToken string, fields map[string]string) string {
	keys := make([]string, 0, len(fields))
	for k := range fields {
		if k != "hash" {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	pairs := make([]string, 0, len(keys))
	for _, k := range keys {
		pairs = append(pairs, k+"="+fields[k])
	}
	secret := sha256.Sum256([]byte(botToken))
	mac := hmac.New(sha256.New, secret[:])
	mac.Write([]byte(strings.Join(pairs, "\n")))
	return hex.EncodeToString(mac.Sum(nil))
}

// widgetBody marshals the numeric fields the widget actually sends
// (id and auth_date are JSON numbers) plus the string fields.
func widgetBody(t *testing.T, id int64, firstName, lastName, username, authDate string, hash string) []byte {
	t.Helper()
	if lastName == "" {
		if username == "" {
			return marshal(t, map[string]any{"id": id, "first_name": firstName, "auth_date": num(authDate), "hash": hash})
		}
		return marshal(t, map[string]any{"id": id, "first_name": firstName, "username": username, "auth_date": num(authDate), "hash": hash})
	}
	return marshal(t, map[string]any{
		"id": id, "first_name": firstName, "last_name": lastName, "username": username,
		"auth_date": num(authDate), "hash": hash,
	})
}

func marshal(t *testing.T, v any) []byte {
	t.Helper()
	body, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return body
}

// num keeps the JSON literal exact for auth_date (json.Number).
func num(s string) json.Number { return json.Number(s) }

func TestValidateTelegramWidgetValid(t *testing.T) {
	t.Setenv("TELEGRAM_BOT_TOKEN", testBotToken)
	fields := map[string]string{
		"auth_date":  freshAuthDate(),
		"first_name": "Mila",
		"id":         "123456789",
		"last_name":  "Petrović",
		"username":   "milap",
	}
	fields["hash"] = signWidget(testBotToken, fields)

	identity, err := ValidateTelegramWidget(widgetBody(t, 123456789, "Mila", "Petrović", "milap", fields["auth_date"], fields["hash"]))
	if err != nil {
		t.Fatalf("valid widget must pass: %v", err)
	}
	if identity.Messenger != "telegram" ||
		identity.MessengerID != "123456789" ||
		identity.DisplayName != "Mila Petrović" ||
		identity.MessengerLogin == nil || *identity.MessengerLogin != "@milap" {
		t.Fatalf("unexpected identity: %+v", identity)
	}
	payload := identity.ToTicketPayload(TicketPurposeGuest)
	if payload.Messenger != "telegram" || payload.MessengerID != "123456789" {
		t.Fatalf("unexpected ticket payload: %+v", payload)
	}
}

func TestValidateTelegramWidgetNoUsername(t *testing.T) {
	t.Setenv("TELEGRAM_BOT_TOKEN", testBotToken)
	fields := map[string]string{"auth_date": freshAuthDate(), "first_name": "Noah", "id": "42"}
	fields["hash"] = signWidget(testBotToken, fields)

	identity, err := ValidateTelegramWidget(widgetBody(t, 42, "Noah", "", "", fields["auth_date"], fields["hash"]))
	if err != nil {
		t.Fatalf("valid widget must pass: %v", err)
	}
	if identity.MessengerLogin != nil {
		t.Fatalf("username absent → no messenger login, got %q", *identity.MessengerLogin)
	}
	if identity.DisplayName != "Noah" {
		t.Fatalf("unexpected display name %q", identity.DisplayName)
	}
}

// Replay protection: a correctly signed but stale payload must be
// refused — otherwise a captured widget body could mint tickets
// forever (hasDataExpired in the TS validator, 24h window).
func TestValidateTelegramWidgetExpired(t *testing.T) {
	t.Setenv("TELEGRAM_BOT_TOKEN", testBotToken)
	fields := map[string]string{"auth_date": expiredAuthDate(), "first_name": "Mila", "id": "123456789"}
	fields["hash"] = signWidget(testBotToken, fields)

	if _, err := ValidateTelegramWidget(widgetBody(t, 123456789, "Mila", "", "", fields["auth_date"], fields["hash"])); err != ErrTelegramValidationFailed {
		t.Fatalf("expired widget must fail validation, got %v", err)
	}
}

// A future auth_date is a forged claim, not a slow clock: the past
// window is 24h, the future direction only clock skew (5 minutes).
func TestValidateTelegramWidgetFutureRejected(t *testing.T) {
	t.Setenv("TELEGRAM_BOT_TOKEN", testBotToken)
	fields := map[string]string{"auth_date": futureAuthDate(), "first_name": "Mila", "id": "123456789"}
	fields["hash"] = signWidget(testBotToken, fields)

	if _, err := ValidateTelegramWidget(widgetBody(t, 123456789, "Mila", "", "", fields["auth_date"], fields["hash"])); err != ErrTelegramValidationFailed {
		t.Fatalf("widget an hour in the future must fail validation, got %v", err)
	}
}

func TestValidateTelegramWidgetTampered(t *testing.T) {
	t.Setenv("TELEGRAM_BOT_TOKEN", testBotToken)
	fields := map[string]string{"auth_date": freshAuthDate(), "first_name": "Mila", "id": "123456789"}
	fields["hash"] = signWidget(testBotToken, fields)

	// The hash no longer covers first_name=Mila (payload says Evil).
	if _, err := ValidateTelegramWidget(widgetBody(t, 123456789, "Evil", "", "", fields["auth_date"], fields["hash"])); err != ErrTelegramValidationFailed {
		t.Fatalf("tampered payload must fail HMAC validation, got %v", err)
	}
}

func TestValidateTelegramWidgetWrongBotToken(t *testing.T) {
	t.Setenv("TELEGRAM_BOT_TOKEN", "another:bot")
	fields := map[string]string{"auth_date": freshAuthDate(), "first_name": "Mila", "id": "123456789"}
	fields["hash"] = signWidget(testBotToken, fields)

	if _, err := ValidateTelegramWidget(widgetBody(t, 123456789, "Mila", "", "", fields["auth_date"], fields["hash"])); err != ErrTelegramValidationFailed {
		t.Fatalf("signature minted for a different bot must fail, got %v", err)
	}
}

func TestValidateTelegramWidgetMalformed(t *testing.T) {
	t.Setenv("TELEGRAM_BOT_TOKEN", testBotToken)
	cases := map[string][]byte{
		"empty":         {},
		"not json":      []byte("nope"),
		"array":         []byte(`[1,2]`),
		"missing hash":  []byte(`{"id":123456789,"first_name":"Mila","auth_date":1700000000}`),
		"short hash":    []byte(`{"id":123456789,"first_name":"Mila","auth_date":1700000000,"hash":"abc"}`),
		"string id":     []byte(`{"id":"123456789","first_name":"Mila","auth_date":1700000000,"hash":"` + strings.Repeat("0", 64) + `"}`),
		"string date":   []byte(`{"id":123456789,"first_name":"Mila","auth_date":"1700000000","hash":"` + strings.Repeat("0", 64) + `"}`),
		"no first name": []byte(`{"id":123456789,"auth_date":1700000000,"hash":"` + strings.Repeat("0", 64) + `"}`),
		"bad auth_date": []byte(`{"id":123456789,"first_name":"Mila","auth_date":0,"hash":"` + strings.Repeat("0", 64) + `"}`),
		"bad photo_url": []byte(`{"id":123456789,"first_name":"Mila","auth_date":1700000000,"photo_url":"not a url","hash":"` + strings.Repeat("0", 64) + `"}`),
	}
	for name, body := range cases {
		if _, err := ValidateTelegramWidget(body); err != ErrTelegramInvalid {
			t.Errorf("%s: want ErrTelegramInvalid, got %v", name, err)
		}
	}
}

func TestValidateTelegramWidgetNotConfigured(t *testing.T) {
	t.Setenv("TELEGRAM_BOT_TOKEN", "")
	if _, err := ValidateTelegramWidget([]byte(`{}`)); err != ErrTelegramNotConfigured {
		t.Fatalf("missing bot token must be ErrTelegramNotConfigured, got %v", err)
	}
}

// The data-check-string must cover every submitted field except hash —
// extra fields participate in the HMAC even though the schema ignores
// them, exactly like objectToAuthDataMap in the TS validator.
func TestValidateTelegramWidgetExtraField(t *testing.T) {
	t.Setenv("TELEGRAM_BOT_TOKEN", testBotToken)
	authDate := freshAuthDate()

	// Re-signed over all fields including the extra one: passes.
	withExtra := map[string]string{
		"auth_date": authDate, "first_name": "Mila", "id": "123456789", "extra": "value",
	}
	withExtra["hash"] = signWidget(testBotToken, withExtra)
	body := marshal(t, map[string]any{
		"id": 123456789, "first_name": "Mila", "extra": "value",
		"auth_date": num(authDate), "hash": withExtra["hash"],
	})
	if _, err := ValidateTelegramWidget(body); err != nil {
		t.Fatalf("re-signed extra field must pass: %v", err)
	}

	// A hash signed over the base fields only must fail once the extra
	// field travels along — the check-string covers every field.
	base := map[string]string{"auth_date": authDate, "first_name": "Mila", "id": "123456789"}
	staleHash := signWidget(testBotToken, base)
	body = marshal(t, map[string]any{
		"id": 123456789, "first_name": "Mila", "extra": "value",
		"auth_date": num(authDate), "hash": staleHash,
	})
	if _, err := ValidateTelegramWidget(body); err != ErrTelegramValidationFailed {
		t.Fatalf("hash ignoring the extra field must fail, got %v", err)
	}
}
