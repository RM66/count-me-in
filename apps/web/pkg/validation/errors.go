// Package validation ports the Zod input schemas of @repo/contracts to the
// Go API (ADR-016). Structural validation — types, bounds, enums, patterns,
// required — runs against the OpenAPI spec via kin-openapi (spec.go); the
// rules JSON Schema cannot express (timezones, URLs, reserved slugs, option
// consistency, slot-in-past) stay hand-written in rules.go / refine.go.
//
// Error bodies mirror z.flattenError ({formErrors, fieldErrors}) and are
// never shown to users verbatim — the API responds with a localized generic
// plus these details for logs/devtools. Message text is kin-openapi's
// phrasing; vectors pin error *keys*, not text.
package validation

import (
	"encoding/json"
	"strings"
)

// Errors mirrors z.flattenError's shape.
type Errors struct {
	Form   []string            `json:"formErrors"`
	Fields map[string][]string `json:"fieldErrors"`
}

// NewErrors initializes both collections so JSON marshaling matches
// z.flattenError exactly — "formErrors":[] rather than null.
func NewErrors() *Errors {
	return &Errors{Form: []string{}, Fields: map[string][]string{}}
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

// rawObject decodes the body into per-key raw values so each field can be
// attributed by name. Null, non-object and malformed bodies become form
// errors, like safeParse(null) in Zod.
func rawObject(body []byte) (map[string]json.RawMessage, *Errors) {
	if len(body) == 0 {
		return nil, FormErrors("Invalid input: expected object, received null")
	}
	m := map[string]json.RawMessage{}
	if err := json.Unmarshal(body, &m); err != nil {
		// Valid JSON of another kind names the kind, like Zod's safeParse;
		// only malformed JSON is "Invalid JSON".
		if json.Valid(body) {
			return nil, FormErrors("Invalid input: expected object, received " + kindOf(body))
		}
		return nil, FormErrors("Invalid JSON")
	}
	if m == nil {
		return nil, FormErrors("Invalid input: expected object, received null")
	}
	return m, nil
}

// kindOf names the JSON kind of a raw value for a Zod-style message.
// strings.TrimSpace is enough here: the bytes between values in a JSON
// document are only space/tab/CR/LF (RFC 8259), a subset of both TrimSpace
// and jsTrim — unlike field values, which need the exact JS trim set.
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

// jsTrim matches JavaScript String.prototype.trim(), which Zod's .trim() calls:
// the Unicode WhiteSpace set plus line terminators plus U+FEFF, and *not*
// U+0085 — strings.TrimSpace differs at both ends of that list. The vectors
// pin BOM-padded input, so the exact set matters.
func jsTrim(v string) string {
	return strings.TrimFunc(v, func(r rune) bool {
		switch r {
		case '\t', '\n', '\v', '\f', '\r', ' ', 0x00A0, 0xFEFF,
			0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000:
			return true
		}
		return r >= 0x2000 && r <= 0x200A
	})
}

// ── Zod transforms the spec cannot express ──────────────────────────────────
//
// Zod's .trim() and .toLowerCase() run before the checks; kin-openapi only
// validates. The Decode functions apply the same transforms to the raw body
// first, so bounds see the same value Zod would have checked.

// trimJSONKey applies jsTrim (JavaScript String.prototype.trim, which Zod's
// .trim() calls) to a string property. Absent keys are left absent —
// inserting a nil entry would turn "untouched" into a validation failure.
func trimJSONKey(m map[string]json.RawMessage, key string) {
	if _, ok := m[key]; !ok {
		return
	}
	m[key] = trimJSONValue(m[key])
}

// trimJSONValue trims a string, or every string inside a string array
// (Zod's .trim() on option lists). Non-strings pass through unchanged.
func trimJSONValue(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return raw
	}
	switch raw[0] {
	case '"':
		var s string
		if err := json.Unmarshal(raw, &s); err != nil {
			return raw
		}
		trimmed, _ := json.Marshal(jsTrim(s))
		return trimmed
	case '[':
		var items []json.RawMessage
		if err := json.Unmarshal(raw, &items); err != nil {
			return raw
		}
		for i, item := range items {
			items[i] = trimJSONValue(item)
		}
		out, err := json.Marshal(items)
		if err != nil {
			return raw
		}
		return out
	default:
		return raw
	}
}

// lowerJSONKey lowercases a string property (Zod .toLowerCase()).
func lowerJSONKey(m map[string]json.RawMessage, key string) {
	raw := m[key]
	if len(raw) == 0 || raw[0] != '"' {
		return
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return
	}
	lowered, _ := json.Marshal(strings.ToLower(s))
	m[key] = lowered
}
