package auth

import (
	"bytes"
	"countmein/internal/contracts"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Server-side validation of a Telegram Login Widget payload (ADR-008).
// The payload is attacker-controlled until the HMAC has been verified
// against the bot token; only the identity returned here may be
// persisted. Port of @telegram-auth/server's AuthDataValidator.

var (
	ErrTelegramNotConfigured    = errors.New("TELEGRAM_BOT_TOKEN is not set")
	ErrTelegramInvalid          = errors.New("telegram auth data is malformed")
	ErrTelegramValidationFailed = errors.New("telegram auth data failed HMAC validation")
)

// TelegramIdentity is a validated Telegram identity mapped onto the
// fields the app speaks (messenger + messengerId, ADR-008) rather than
// Telegram's own snake_case shape.
type TelegramIdentity struct {
	Messenger      string
	MessengerID    string
	DisplayName    string
	PhotoURL       *string
	MessengerLogin *string
}

// ToTicketPayload converts the validated identity into the ticket shape.
func (t TelegramIdentity) ToTicketPayload() contracts.AuthTicketPayload {
	return contracts.AuthTicketPayload{
		Messenger:      t.Messenger,
		MessengerID:    t.MessengerID,
		DisplayName:    t.DisplayName,
		PhotoURL:       t.PhotoURL,
		MessengerLogin: t.MessengerLogin,
	}
}

// widgetDataValidAfter mirrors @telegram-auth/server's
// inValidateDataAfter default: a widget payload older than 24 hours
// is expired. Without this, a captured widget body (browser history,
// access logs, a leaked request) could be replayed forever to mint
// fresh single-use tickets for that identity.
const widgetDataValidAfter = 86400

// ValidateTelegramWidget shape-checks and HMAC-verifies a widget body.
// Errors: ErrTelegramNotConfigured (500 at the route),
// ErrTelegramInvalid (400 telegramInvalid) for malformed payloads,
// ErrTelegramValidationFailed (400 telegramValidationFailed) for a
// signature mismatch or an expired auth_date.
func ValidateTelegramWidget(body []byte) (*TelegramIdentity, error) {
	botToken := os.Getenv("TELEGRAM_BOT_TOKEN")
	if botToken == "" {
		return nil, ErrTelegramNotConfigured
	}

	// Decode with UseNumber so numeric literals keep their on-the-wire
	// shape for the data-check-string.
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	var raw map[string]any
	if err := dec.Decode(&raw); err != nil {
		return nil, ErrTelegramInvalid
	}

	// Shape check (telegramWidgetPayload port): id/auth_date positive
	// ints, first_name non-empty, hash exactly 64 chars, optionals
	// strings and photo_url a URL.
	id, ok := numberInt64(raw["id"])
	if !ok || id <= 0 {
		return nil, ErrTelegramInvalid
	}
	firstName, ok := raw["first_name"].(string)
	if !ok || len(firstName) == 0 {
		return nil, ErrTelegramInvalid
	}
	lastName, hasLastName := optionalString(raw["last_name"])
	if hasLastName == malformed {
		return nil, ErrTelegramInvalid
	}
	username, hasUsername := optionalString(raw["username"])
	if hasUsername == malformed {
		return nil, ErrTelegramInvalid
	}
	photoURL, hasPhotoURL := optionalString(raw["photo_url"])
	if hasPhotoURL == present && !validURL(*photoURL) {
		return nil, ErrTelegramInvalid
	}
	authDate, ok := numberInt64(raw["auth_date"])
	if !ok || authDate <= 0 {
		return nil, ErrTelegramInvalid
	}
	hash, ok := raw["hash"].(string)
	if !ok || len(hash) != 64 {
		return nil, ErrTelegramInvalid
	}

	// data-check-string: every field except hash, key-sorted,
	// "key=value" joined with \n — exactly the fields the widget signed.
	keys := make([]string, 0, len(raw))
	for k := range raw {
		if k != "hash" {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	pairs := make([]string, 0, len(keys))
	for _, k := range keys {
		s, ok := scalarString(raw[k])
		if !ok {
			return nil, ErrTelegramInvalid
		}
		pairs = append(pairs, k+"="+s)
	}
	dcs := strings.Join(pairs, "\n")

	// secret = SHA256(bot_token); hash = HMAC-SHA256(secret, dcs) hex.
	secret := sha256.Sum256([]byte(botToken))
	mac := hmac.New(sha256.New, secret[:])
	mac.Write([]byte(dcs))
	expected := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(hash)) {
		return nil, ErrTelegramValidationFailed
	}

	// Freshness (hasDataExpired in the TS validator): the HMAC proves
	// the payload came from Telegram, not that it was sent recently.
	if time.Now().Unix()-authDate > widgetDataValidAfter {
		return nil, ErrTelegramValidationFailed
	}

	identity := &TelegramIdentity{
		Messenger:   "telegram",
		MessengerID: strconv.FormatInt(id, 10),
		DisplayName: strings.TrimSpace(strings.TrimSpace(firstName) + " " + derefOr(lastName, "")),
		PhotoURL:    nilIfEmpty(photoURL),
	}
	if username != nil && *username != "" {
		login := "@" + *username
		identity.MessengerLogin = &login
	}
	return identity, nil
}

const (
	absent    = 0
	present   = 1
	malformed = 2
)

// optionalString classifies an optional string field.
func optionalString(v any) (*string, int) {
	if v == nil {
		return nil, absent
	}
	s, ok := v.(string)
	if !ok {
		return nil, malformed
	}
	return &s, present
}

func numberInt64(v any) (int64, bool) {
	n, ok := v.(json.Number)
	if !ok {
		return 0, false
	}
	i, err := strconv.ParseInt(n.String(), 10, 64)
	if err != nil {
		return 0, false
	}
	return i, true
}

// scalarString renders a widget value for the data-check-string:
// strings as-is, numbers via their literal (objectToAuthDataMap).
func scalarString(v any) (string, bool) {
	switch t := v.(type) {
	case string:
		return t, true
	case json.Number:
		return t.String(), true
	}
	return "", false
}

func validURL(s string) bool {
	u, err := url.Parse(s)
	return err == nil && u.Scheme != "" && (u.Host != "" || u.Opaque != "")
}

func derefOr(s *string, def string) string {
	if s != nil {
		return *s
	}
	return def
}

func nilIfEmpty(s *string) *string {
	if s == nil || *s == "" {
		return nil
	}
	return s
}
