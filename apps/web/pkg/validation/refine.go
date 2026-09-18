package validation

import (
	"strings"

	"countmein/pkg/contracts"
)

// Hand-written refinement tails for Parse* inputs: everything Zod expresses
// via .refine/.superRefine that JSON Schema cannot carry. Called at the end of
// the generated Parse* (see x-go-refine in wire.ts). Pinned by
// packages/contracts/vectors/validation/*.
//
// Note on message counts: the refinements below read parsed values, while the
// Zod refinements read raw input — so an invalid optionsSelectMode value with
// options set yields two messages on optionsSelectMode in Go (rule + consistency)
// and one in Zod (rule only). Keys always agree; only vectors pin them, never
// message text or per-field counts (see D4).

func refineCreateServiceInput(e *Errors, out *contracts.CreateServiceInput) {
	if out.Options != nil {
		if len(out.Options) == 0 {
			e.Add("options", "Too small: expected array to have >=1 items")
		}
		seenOptions := make(map[string]bool, len(out.Options))
		for _, option := range out.Options {
			if seenOptions[option] {
				e.Add("options", "options must be unique")
				break
			}
			seenOptions[option] = true
		}
	}
	hasOptions := len(out.Options) > 0
	hasMode := out.OptionsSelectMode != nil && *out.OptionsSelectMode != ""
	if hasOptions && !hasMode {
		e.Add("optionsSelectMode", "optionsSelectMode is required when options are set")
	}
	if !hasOptions && hasMode {
		e.Add("optionsSelectMode", "optionsSelectMode must be omitted when there are no options")
	}
}

func refineUpdateServiceInput(e *Errors, out *contracts.UpdateServiceInput) {
	if out.Options.Set && out.Options.Value != nil {
		opts := *out.Options.Value
		if len(opts) == 0 {
			e.Add("options", "Too small: expected array to have >=1 items")
		}
		seenOptions := make(map[string]bool, len(opts))
		for _, option := range opts {
			if seenOptions[option] {
				e.Add("options", "options must be unique")
				break
			}
			seenOptions[option] = true
		}
	}
	if out.Options.Set || out.OptionsSelectMode.Set {
		hasOptions := out.Options.Set && out.Options.Value != nil && len(*out.Options.Value) > 0
		hasMode := out.OptionsSelectMode.Set && out.OptionsSelectMode.Value != nil && *out.OptionsSelectMode.Value != ""
		if hasOptions && !hasMode {
			e.Add("optionsSelectMode", "optionsSelectMode is required when options are set")
		}
		if !hasOptions && hasMode {
			e.Add("optionsSelectMode", "optionsSelectMode must be omitted when there are no options")
		}
	}
}

func refineRegisterOrganizerInput(e *Errors, out *contracts.RegisterOrganizerInput) {
	out.Slug = strings.ToLower(out.Slug)
}

func refineUpdateOrganizerProfileInput(e *Errors, out *contracts.UpdateOrganizerProfileInput) {
	if out.Slug.Set && out.Slug.Value != nil {
		lowercasedSlug := strings.ToLower(*out.Slug.Value)
		out.Slug.Value = &lowercasedSlug
	}
}

func refineCreateTimeSlotInput(e *Errors, out *contracts.CreateTimeSlotInput) {
	if !out.StartsAt.IsZero() && !isAcceptableSlotStart(out.StartsAt) {
		e.Add("startsAt", contracts.SlotStartInPastMessage)
	}
}

func refineUpdateTimeSlotInput(e *Errors, out *contracts.UpdateTimeSlotInput) {
	if out.StartsAt.Set && out.StartsAt.Value != nil && !isAcceptableSlotStart(out.StartsAt.Value.Time()) {
		e.Add("startsAt", contracts.SlotStartInPastMessage)
	}
}
