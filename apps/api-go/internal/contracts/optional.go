package contracts

import (
	"encoding/json"
	"time"
)

// Optional distinguishes an absent JSON key from an explicit null —
// Zod's `optional()` vs `nullable()` distinction. Set=false: absent;
// Set=true, Value=nil: explicit null; Set=true, Value!=nil: value.
type Optional[T any] struct {
	Set   bool
	Value *T
}

func (o *Optional[T]) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(b) == "null" {
		o.Value = nil
		return nil
	}
	var v T
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	o.Value = &v
	return nil
}

// ValueOr returns the value, or def when absent or null.
func ValueOr[T any](o Optional[T], def T) T {
	if o.Value != nil {
		return *o.Value
	}
	return def
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
