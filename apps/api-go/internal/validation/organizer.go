package validation

import (
	"encoding/json"
	"strings"

	"api-go/internal/contracts"
)

// slugValue validates a slug: trim → lowercase → length/pattern/reserved.
// Returns the transformed value and whether it is valid.
func slugValue(e *Errors, raw map[string]json.RawMessage, name string) (string, bool) {
	rawJSON, present := raw[name]
	if !present {
		e.Add(name, "Required")
		return "", false
	}
	if string(rawJSON) == "null" {
		e.Add(name, "Invalid input: expected string, received null")
		return "", false
	}
	var v string
	if err := jsonUnmarshalString(rawJSON, &v); err != nil {
		e.Add(name, "Invalid input: expected string, received "+kindOf(rawJSON))
		return "", false
	}
	v = strings.ToLower(strings.TrimSpace(v))
	if msg := SlugRule(v); msg != "" {
		e.Add(name, msg)
		return "", false
	}
	return v, true
}

// ParseRegisterOrganizerInput — public registration (ADR-008): the
// messenger identity comes from the auth ticket (validated server-side),
// never from the client. The ticket is only peeked here — it stays
// valid for the Auth.js sign-in exchange.
func ParseRegisterOrganizerInput(body []byte) (contracts.RegisterOrganizerInput, *Errors) {
	m, e := rawObject(body)
	if e != nil {
		return contracts.RegisterOrganizerInput{}, e
	}
	e = NewErrors()
	var out contracts.RegisterOrganizerInput

	out.Ticket, _ = strValue(e, m, "ticket", true, false, AuthTicketRule)
	if slug, ok := slugValue(e, m, "slug"); ok {
		out.Slug = slug
	}
	out.Name, _ = strValue(e, m, "name", true, true, DisplayNameRule)
	out.Timezone, _ = strValue(e, m, "timezone", true, false, TimezoneRule)
	if v, present := strValue(e, m, "contact", false, true, ContactRule); present {
		out.Contact = &v
	}
	// Notification language (ADR-011) — optional in the request.
	if v, _ := strValue(e, m, "language", false, false, localeRule); v != "" {
		out.Language = v
	} else {
		out.Language = contracts.DefaultLocale
	}
	return out, e.Finish()
}

// ParseUpdateOrganizerProfileInput — profile edits from the cabinet;
// messenger identity is not editable, language is owned by the switcher.
func ParseUpdateOrganizerProfileInput(body []byte) (contracts.UpdateOrganizerProfileInput, *Errors) {
	m, e := rawObject(body)
	if e != nil {
		return contracts.UpdateOrganizerProfileInput{}, e
	}
	e = NewErrors()
	var out contracts.UpdateOrganizerProfileInput

	out.Name = optStr(e, m, "name", true, false, DisplayNameRule)

	// slug: transform trim+lowercase, then the same rules as register.
	if raw, present := m["slug"]; present {
		if string(raw) == "null" {
			e.Add("slug", "Invalid input: expected string, received null")
		} else {
			var v string
			if err := jsonUnmarshalString(raw, &v); err != nil {
				e.Add("slug", "Invalid input: expected string, received "+kindOf(raw))
			} else {
				v = strings.ToLower(strings.TrimSpace(v))
				if msg := SlugRule(v); msg != "" {
					e.Add("slug", msg)
				} else {
					out.Slug = contracts.Optional[string]{Set: true, Value: &v}
				}
			}
		}
	}

	out.Timezone = optStr(e, m, "timezone", false, false, TimezoneRule)
	out.Description = optStr(e, m, "description", true, true, OrganizerDescriptionRule)
	out.Location = optStr(e, m, "location", true, true, LocationRule)
	out.Contact = optStr(e, m, "contact", true, true, ContactRule)
	out.PhotoURL = optStr(e, m, "photoUrl", false, true, URLRule)
	return out, e.Finish()
}
