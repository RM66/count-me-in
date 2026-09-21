package contracts

import (
	"encoding/json"
	"time"

	gen "countmein/pkg/api/gen"

	"github.com/google/uuid"
)

// DerefOr returns the value behind a pointer, or the default when nil.
// Shared by the routes handlers and the Telegram widget parser, which
// both read oapi-codegen's optional pointer fields.
func DerefOr[T any](p *T, def T) T {
	if p == nil {
		return def
	}
	return *p
}

// ISODate renders t like JS Date.toISOString(): always UTC, always
// millisecond precision ("2026-09-13T10:15:35.250Z").
func ISODate(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}

// FlexTime accepts an RFC3339 string or a Unix epoch number (seconds
// or milliseconds). A deliberate tightening over Zod's
// z.coerce.date(), which accepts anything new Date() parses
// ("2026-09-13" etc.). Confirmed safe for the wire: the only writer of
// startsAt is the cabinet slot form, which folds date+time through
// wallClockToInstant into a Date — JSON.stringify serializes it as a
// full ISO string. Formats new Date() parses as *local* time
// (date-only, no-zone datetime) are rejected rather than guessed:
// reproducing server-local semantics would be worse than a 400.
type FlexTime time.Time

func (f *FlexTime) UnmarshalJSON(b []byte) error {
	s := string(b)
	if len(s) > 0 && s[0] == '"' {
		var str string
		if err := json.Unmarshal(b, &str); err != nil {
			return err
		}
		t, err := parseRFC3339(str)
		if err != nil {
			return err
		}
		*f = FlexTime(t)
		return nil
	}
	var n float64
	if err := json.Unmarshal(b, &n); err != nil {
		return err
	}
	// Heuristic: > 1e12 means milliseconds, else seconds.
	ms := n
	if n <= 1e12 {
		ms = n * 1000
	}
	*f = FlexTime(time.UnixMilli(int64(ms)).UTC())
	return nil
}

func parseRFC3339(s string) (time.Time, error) {
	for _, layout := range []string{time.RFC3339, time.RFC3339Nano} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, nil
		}
	}
	return time.Time{}, &json.UnmarshalTypeError{Value: "date string"}
}

func (f FlexTime) Time() time.Time { return time.Time(f) }

// FlexTimeFromRaw decodes the raw JSON behind a generated SlotStartsAt
// union (oapi-codegen renders oneOf as json.RawMessage) into a FlexTime.
func FlexTimeFromRaw(raw json.RawMessage) (FlexTime, error) {
	var f FlexTime
	if err := json.Unmarshal(raw, &f); err != nil {
		return f, err
	}
	return f, nil
}

// ── Generated-type helpers ───────────────────────────────────────────────────
//
// The wire structs live in pkg/api/gen (oapi-codegen); the database and
// job layers keep working with plain strings and time.Time. These two
// adapters are the only place that converts between the shapes, so a
// change of representation has one seam.

// ToUUID converts a canonical UUID string into the generated wire type.
// An invalid input yields the zero UUID (never panics) — callers reach
// this with values that already passed the spec's uuid pattern, so the
// fallback only fires on DB corruption, where a zero id fails closed
// downstream instead of crashing the function.
func ToUUID(s string) gen.UUID {
	parsed, err := uuid.Parse(s)
	if err != nil {
		return gen.UUID{}
	}
	return gen.UUID(parsed)
}

// UUIDString renders the generated wire UUID back into its canonical
// text form.
func UUIDString(u gen.UUID) string {
	return uuid.UUID(u).String()
}
