// Package validation ports the Zod input schemas of @repo/contracts.
// Parse functions decode raw JSON bodies into contracts inputs and
// return *Errors (nil when valid); error bodies mirror z.flattenError
// ({formErrors, fieldErrors}) and are never shown to users verbatim —
// the API responds with a localized generic plus these details for
// logs/devtools.
package validation

import (
	"encoding/json"
	"fmt"
	"strings"

	"countmein/pkg/contracts"
)

// Errors mirrors z.flattenError's shape.
type Errors struct {
	Form   []string            `json:"formErrors"`
	Fields map[string][]string `json:"fieldErrors"`
}

func NewErrors() *Errors {
	return &Errors{Fields: map[string][]string{}}
}

func (e *Errors) Add(field, msg string) {
	if e.Fields == nil {
		e.Fields = map[string][]string{}
	}
	e.Fields[field] = append(e.Fields[field], msg)
}

func (e *Errors) AddForm(msg string) {
	e.Form = append(e.Form, msg)
}

func (e *Errors) Empty() bool {
	return len(e.Form) == 0 && len(e.Fields) == 0
}

// Finish returns e, or nil when no issue was collected.
func (e *Errors) Finish() *Errors {
	if e != nil && e.Empty() {
		return nil
	}
	return e
}

func FormErrors(msg string) *Errors {
	e := NewErrors()
	e.AddForm(msg)
	return e
}

// rawObject decodes the body into per-key raw values so each field can
// be attributed by name. Null, non-object and malformed bodies become
// form errors, like safeParse(null) in Zod.
func rawObject(body []byte) (map[string]json.RawMessage, *Errors) {
	if len(body) == 0 {
		return nil, FormErrors("Invalid input: expected object, received null")
	}
	m := map[string]json.RawMessage{}
	if err := json.Unmarshal(body, &m); err != nil {
		return nil, FormErrors("Invalid JSON")
	}
	if m == nil {
		return nil, FormErrors("Invalid input: expected object, received null")
	}
	return m, nil
}

func kindOf(raw json.RawMessage) string {
	s := strings.TrimSpace(string(raw))
	if s == "" {
		return "undefined"
	}
	switch s[0] {
	case '"':
		return "string"
	case '{':
		return "object"
	case '[':
		return "array"
	case 't', 'f':
		return "boolean"
	case 'n':
		return "null"
	default:
		return "number"
	}
}

// ── Field helpers ──────────────────────────────────────────────────────────
// Each returns (value, present). present=false means absent (no error);
// invalid values add a field error and return present=true with a zero
// value — callers may still assign it, the response is a 400 anyway.

func strValue(e *Errors, m map[string]json.RawMessage, name string, required, trim bool, rule func(string) string) (string, bool) {
	raw, present := m[name]
	if !present {
		if required {
			e.Add(name, "Required")
		}
		return "", false
	}
	if string(raw) == "null" {
		e.Add(name, "Invalid input: expected string, received null")
		return "", true
	}
	var v string
	if err := json.Unmarshal(raw, &v); err != nil {
		e.Add(name, "Invalid input: expected string, received "+kindOf(raw))
		return "", true
	}
	if trim {
		v = strings.TrimSpace(v)
	}
	if rule != nil {
		if msg := rule(v); msg != "" {
			e.Add(name, msg)
			return "", true
		}
	}
	return v, present
}

func intValue(e *Errors, m map[string]json.RawMessage, name string, required bool, rule func(int64) string) (int64, bool) {
	raw, present := m[name]
	if !present {
		if required {
			e.Add(name, "Required")
		}
		return 0, false
	}
	if string(raw) == "null" {
		e.Add(name, "Invalid input: expected number, received null")
		return 0, true
	}
	var f float64
	if err := json.Unmarshal(raw, &f); err != nil || f != float64(int64(f)) {
		e.Add(name, "Invalid input: expected int, received "+kindOf(raw))
		return 0, true
	}
	n := int64(f)
	if rule != nil {
		if msg := rule(n); msg != "" {
			e.Add(name, msg)
			return 0, true
		}
	}
	return n, present
}

func strArrValue(e *Errors, m map[string]json.RawMessage, name string, required, trim bool, elemRule func(string) string, max int) ([]string, bool) {
	raw, present := m[name]
	if !present {
		if required {
			e.Add(name, "Required")
		}
		return nil, false
	}
	if string(raw) == "null" {
		e.Add(name, "Invalid input: expected array, received null")
		return nil, true
	}
	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil {
		e.Add(name, "Invalid input: expected array, received "+kindOf(raw))
		return nil, true
	}
	if len(items) > max {
		e.Add(name, fmt.Sprintf("array must contain at most %d element(s)", max))
		return nil, true
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		var v string
		if err := json.Unmarshal(item, &v); err != nil {
			e.Add(name, "Invalid input: expected string, received "+kindOf(item))
			return nil, true
		}
		if trim {
			v = strings.TrimSpace(v)
		}
		if elemRule != nil {
			if msg := elemRule(v); msg != "" {
				e.Add(name, msg)
				return nil, true
			}
		}
		out = append(out, v)
	}
	return out, present
}

func flexTimeValue(e *Errors, m map[string]json.RawMessage, name string, required bool, rule func(contracts.FlexTime) string) (contracts.FlexTime, bool) {
	raw, present := m[name]
	if !present {
		if required {
			e.Add(name, "Required")
		}
		return contracts.FlexTime{}, false
	}
	if string(raw) == "null" {
		e.Add(name, "Invalid input: expected date, received null")
		return contracts.FlexTime{}, true
	}
	var ft contracts.FlexTime
	if err := json.Unmarshal(raw, &ft); err != nil {
		e.Add(name, "Invalid input: expected date, received "+kindOf(raw))
		return contracts.FlexTime{}, true
	}
	if rule != nil {
		if msg := rule(ft); msg != "" {
			e.Add(name, msg)
			return contracts.FlexTime{}, true
		}
	}
	return ft, present
}

// ── Optional field helpers (update inputs: absent / null / value) ────────────

func optStr(e *Errors, m map[string]json.RawMessage, name string, trim, nullable bool, rule func(string) string) contracts.Optional[string] {
	raw, present := m[name]
	var o contracts.Optional[string]
	if !present {
		return o
	}
	o.Set = true
	if string(raw) == "null" {
		if !nullable {
			e.Add(name, "Invalid input: expected string, received null")
			return contracts.Optional[string]{}
		}
		return o // Value nil = explicit null
	}
	var v string
	if err := json.Unmarshal(raw, &v); err != nil {
		e.Add(name, "Invalid input: expected string, received "+kindOf(raw))
		return contracts.Optional[string]{}
	}
	if trim {
		v = strings.TrimSpace(v)
	}
	if rule != nil {
		if msg := rule(v); msg != "" {
			e.Add(name, msg)
			return contracts.Optional[string]{}
		}
	}
	o.Value = &v
	return o
}

func optInt(e *Errors, m map[string]json.RawMessage, name string, nullable bool, rule func(int64) string) contracts.Optional[int] {
	raw, present := m[name]
	var o contracts.Optional[int]
	if !present {
		return o
	}
	o.Set = true
	if string(raw) == "null" {
		if !nullable {
			e.Add(name, "Invalid input: expected number, received null")
			return contracts.Optional[int]{}
		}
		return o
	}
	var f float64
	if err := json.Unmarshal(raw, &f); err != nil || f != float64(int64(f)) {
		e.Add(name, "Invalid input: expected int, received "+kindOf(raw))
		return contracts.Optional[int]{}
	}
	n := int64(f)
	if rule != nil {
		if msg := rule(n); msg != "" {
			e.Add(name, msg)
			return contracts.Optional[int]{}
		}
	}
	i := int(n)
	o.Value = &i
	return o
}

func optFlexTime(e *Errors, m map[string]json.RawMessage, name string, nullable bool, rule func(contracts.FlexTime) string) contracts.Optional[contracts.FlexTime] {
	raw, present := m[name]
	var o contracts.Optional[contracts.FlexTime]
	if !present {
		return o
	}
	o.Set = true
	if string(raw) == "null" {
		if !nullable {
			e.Add(name, "Invalid input: expected date, received null")
			return contracts.Optional[contracts.FlexTime]{}
		}
		return o
	}
	var ft contracts.FlexTime
	if err := json.Unmarshal(raw, &ft); err != nil {
		e.Add(name, "Invalid input: expected date, received "+kindOf(raw))
		return contracts.Optional[contracts.FlexTime]{}
	}
	if rule != nil {
		if msg := rule(ft); msg != "" {
			e.Add(name, msg)
			return contracts.Optional[contracts.FlexTime]{}
		}
	}
	o.Value = &ft
	return o
}

func optStrArr(e *Errors, m map[string]json.RawMessage, name string, nullable bool, elemRule func(string) string, max int) contracts.Optional[[]string] {
	raw, present := m[name]
	var o contracts.Optional[[]string]
	if !present {
		return o
	}
	o.Set = true
	if string(raw) == "null" {
		if !nullable {
			e.Add(name, "Invalid input: expected array, received null")
			return contracts.Optional[[]string]{}
		}
		return o
	}
	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil {
		e.Add(name, "Invalid input: expected array, received "+kindOf(raw))
		return contracts.Optional[[]string]{}
	}
	if len(items) > max {
		e.Add(name, fmt.Sprintf("array must contain at most %d element(s)", max))
		return contracts.Optional[[]string]{}
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		var v string
		if err := json.Unmarshal(item, &v); err != nil {
			e.Add(name, "Invalid input: expected string, received "+kindOf(item))
			return contracts.Optional[[]string]{}
		}
		v = strings.TrimSpace(v)
		if elemRule != nil {
			if msg := elemRule(v); msg != "" {
				e.Add(name, msg)
				return contracts.Optional[[]string]{}
			}
		}
		out = append(out, v)
	}
	o.Value = &out
	return o
}
