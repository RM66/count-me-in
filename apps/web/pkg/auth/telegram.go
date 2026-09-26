package auth

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	gen "countmein/pkg/api/gen"
	"countmein/pkg/contracts"
	"countmein/pkg/validation"
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

// Ticket purposes: a ticket minted for one
// flow must not be redeemable in another.
const (
	TicketPurposeGuest     = "guest"
	TicketPurposeOrganizer = "organizer"
)

// ToTicketPayload converts the validated identity into the ticket shape.
// `purpose` binds the ticket to one flow — the caller decides which
// flow, the payload carries it, and the consuming guard rejects a
// ticket minted for the other flow.
func (t TelegramIdentity) ToTicketPayload(purpose string) contracts.AuthTicketPayload {
	return contracts.AuthTicketPayload{
		Messenger:      gen.Messenger(t.Messenger),
		MessengerID:    t.MessengerID,
		DisplayName:    t.DisplayName,
		PhotoURL:       t.PhotoURL,
		MessengerLogin: t.MessengerLogin,
		Purpose:        purpose,
	}
}

// widgetDataValidAfter mirrors @telegram-auth/server's
// inValidateDataAfter default: a widget payload older than 24 hours
// is expired. Without this, a captured widget body (browser history,
// access logs, a leaked request) could be replayed forever to mint
// fresh single-use tickets for that identity.
const widgetDataValidAfter = 86400

// widgetFutureSkew — how far in the future auth_date may lie. The past
// window is a generous 24h (a guest may take a while between opening the
// widget and completing signup), but the future direction gets only clock
// skew: Telegram signs the current time, so auth_date an hour ahead is a
// forged or replayed claim, not a slow clock.
const widgetFutureSkew = 300

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

	payload, errs := validation.DecodeTelegramWidgetPayload(body)
	if errs != nil {
		return nil, ErrTelegramInvalid
	}

	// Decode with UseNumber so numeric literals keep their on-the-wire
	// shape for the data-check-string.
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	var raw map[string]any
	if err := dec.Decode(&raw); err != nil {
		return nil, ErrTelegramInvalid
	}

	// The data-check-string covers every field the widget sent, including any
	// the schema does not model — it is computed from the raw body, never from
	// the parsed struct.
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
	if !hmac.Equal([]byte(expected), []byte(payload.Hash)) {
		return nil, ErrTelegramValidationFailed
	}

	// Freshness (hasDataExpired in the TS validator): the HMAC proves
	// the payload came from Telegram, not that it was sent recently.
	// Asymmetric: stale payloads are rejected past 24h, future ones past
	// clock skew — a future auth_date is a forged claim, not a slow
	// guest.
	age := time.Now().Unix() - int64(payload.AuthDate)
	if age > widgetDataValidAfter || age < -widgetFutureSkew {
		return nil, ErrTelegramValidationFailed
	}

	identity := &TelegramIdentity{
		Messenger:   "telegram",
		MessengerID: strconv.FormatInt(int64(payload.ID), 10),
		DisplayName: strings.TrimSpace(strings.TrimSpace(payload.FirstName) + " " + contracts.DerefOr(payload.LastName, "")),
		PhotoURL:    nilIfEmpty(payload.PhotoURL),
	}
	if payload.Username != nil && *payload.Username != "" {
		login := "@" + *payload.Username
		identity.MessengerLogin = &login
	}
	return identity, nil
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

func nilIfEmpty(s *string) *string {
	if s == nil || *s == "" {
		return nil
	}
	return s
}
