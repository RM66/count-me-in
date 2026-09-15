package validation

import (
	"api-go/internal/contracts"
)

func optionsSelectModeRule(v string) string {
	if v != string(contracts.OptionsSingle) && v != string(contracts.OptionsMulti) {
		return "Invalid input: expected one of single|multi"
	}
	return ""
}

func hasDuplicates(values []string) bool {
	seen := map[string]bool{}
	for _, v := range values {
		if seen[v] {
			return true
		}
		seen[v] = true
	}
	return false
}

// optionsConsistency — optionsSelectMode is required iff the service
// defines options. `null` counts as "no options": the cabinet clears an
// option list by sending options: null together with optionsSelectMode: null.
func optionsConsistency(e *Errors, options []string, optionsSelectMode *string) {
	hasOptions := len(options) > 0
	if hasOptions && optionsSelectMode == nil {
		e.Add("optionsSelectMode", "optionsSelectMode is required when options are set")
	}
	if !hasOptions && optionsSelectMode != nil {
		e.Add("optionsSelectMode", "optionsSelectMode must be omitted when there are no options")
	}
}

func optionalOptionsConsistency(e *Errors, options contracts.Optional[[]string], mode contracts.Optional[string]) {
	hasOptions := options.Set && options.Value != nil && len(*options.Value) > 0
	modeSet := mode.Set && mode.Value != nil
	if hasOptions && !modeSet {
		e.Add("optionsSelectMode", "optionsSelectMode is required when options are set")
	}
	if !hasOptions && modeSet {
		e.Add("optionsSelectMode", "optionsSelectMode must be omitted when there are no options")
	}
}

// ParseCreateServiceInput — port of createServiceInput.
func ParseCreateServiceInput(body []byte) (contracts.CreateServiceInput, *Errors) {
	m, e := rawObject(body)
	if e != nil {
		return contracts.CreateServiceInput{}, e
	}
	e = NewErrors()
	var out contracts.CreateServiceInput

	out.Title, _ = strValue(e, m, "title", true, true, DisplayNameRule)
	if v, present := strValue(e, m, "description", false, true, ServiceDescriptionRule); present {
		out.Description = &v
	}
	if v, present := strValue(e, m, "location", false, true, LocationRule); present {
		out.Location = &v
	}
	if v, present := strValue(e, m, "contact", false, true, ContactRule); present {
		out.Contact = &v
	}
	out.DefaultPrice, _ = strValue(e, m, "defaultPrice", true, true, PriceRule)
	capacity, _ := intValue(e, m, "defaultCapacity", true, intRange(1, 100_000))
	out.DefaultCapacity = int(capacity)
	duration, _ := intValue(e, m, "defaultDurationMinutes", true, intRange(1, 1440))
	out.DefaultDurationMinutes = int(duration)
	maxSeats, _ := intValue(e, m, "maxSeatsPerBooking", true, intRange(1, 1000))
	out.MaxSeatsPerBooking = int(maxSeats)

	options, _ := strArrValue(e, m, "options", false, true, OptionLabelRule, 50)
	if len(options) == 0 {
		options = nil // absent and empty both mean "no options"
	} else if len(options) > 0 && hasDuplicates(options) {
		e.Add("options", "options must be unique")
	}
	out.Options = options

	if v, present := strValue(e, m, "optionsSelectMode", false, false, optionsSelectModeRule); present {
		out.OptionsSelectMode = &v
	}
	if v, present := strValue(e, m, "photoUrl", false, false, URLRule); present {
		out.PhotoURL = &v
	}

	optionsConsistency(e, out.Options, out.OptionsSelectMode)
	return out, e.Finish()
}

// ParseUpdateServiceInput — cabinet edits: every optional display field
// is additionally nullable (absent = leave unchanged, null = clear).
func ParseUpdateServiceInput(body []byte) (contracts.UpdateServiceInput, *Errors) {
	m, e := rawObject(body)
	if e != nil {
		return contracts.UpdateServiceInput{}, e
	}
	e = NewErrors()
	var out contracts.UpdateServiceInput

	out.Title = optStr(e, m, "title", true, false, DisplayNameRule)
	out.Description = optStr(e, m, "description", true, true, ServiceDescriptionRule)
	out.Location = optStr(e, m, "location", true, true, LocationRule)
	out.Contact = optStr(e, m, "contact", true, true, ContactRule)
	out.DefaultPrice = optStr(e, m, "defaultPrice", true, false, PriceRule)
	out.DefaultCapacity = optInt(e, m, "defaultCapacity", false, intRange(1, 100_000))
	out.DefaultDurationMinutes = optInt(e, m, "defaultDurationMinutes", false, intRange(1, 1440))
	out.MaxSeatsPerBooking = optInt(e, m, "maxSeatsPerBooking", false, intRange(1, 1000))

	out.Options = optStrArr(e, m, "options", true, OptionLabelRule, 50)
	if out.Options.Set && out.Options.Value != nil {
		if len(*out.Options.Value) == 0 {
			out.Options.Value = nil // empty array clears like null
		} else if hasDuplicates(*out.Options.Value) {
			e.Add("options", "options must be unique")
		}
	}
	out.OptionsSelectMode = optStr(e, m, "optionsSelectMode", false, true, optionsSelectModeRule)
	out.PhotoURL = optStr(e, m, "photoUrl", false, true, URLRule)

	optionalOptionsConsistency(e, out.Options, out.OptionsSelectMode)
	return out, e.Finish()
}
