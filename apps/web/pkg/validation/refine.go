package validation

import (
	gen "countmein/pkg/api/gen"
	"countmein/pkg/contracts"
)

// Hand-written refinement tails for the Decode* inputs: everything Zod
// expresses via .refine/.superRefine that JSON Schema cannot carry. Called
// at the end of the Decode functions; the merge-patch update endpoints run
// the *MergedState variants on the merged result (RFC 7386 semantics).
// Pinned by packages/contracts/vectors/validation/*.
//
// Note on message counts: the refinements read parsed values, while the Zod
// refinements read raw input — so an invalid optionsSelectMode value with
// options set yields two messages on optionsSelectMode in Go (rule +
// consistency) and one in Zod (rule only). Keys always agree; only vectors
// pin them, never message text or per-field counts (see D4).

// refineServiceOptions checks a concrete options/mode pair: non-empty,
// unique, and mode present exactly when options are. Shared by the create
// input (where the pair is the whole payload) and the merged update state.
func refineServiceOptions(e *Errors, options *gen.OptionsList, mode *gen.OptionsSelectMode) {
	if options != nil {
		opts := *options
		if len(opts) == 0 {
			e.Add("options", "Too small: expected array to have >=1 items")
		}
		seen := make(map[string]bool, len(opts))
		for _, option := range opts {
			if seen[option] {
				e.Add("options", "options must be unique")
				break
			}
			seen[option] = true
		}
	}
	hasOptions := options != nil && len(*options) > 0
	hasMode := mode != nil && *mode != ""
	if hasOptions && !hasMode {
		e.Add("optionsSelectMode", "optionsSelectMode is required when options are set")
	}
	if !hasOptions && hasMode {
		e.Add("optionsSelectMode", "optionsSelectMode must be omitted when there are no options")
	}
}

// RefineServiceMergedState runs the options/mode consistency check on the
// merged update state (the handler calls it after jsonpatch.MergePatch).
// The non-nullable fields that RFC 7386 could have removed (patch null on
// a non-nullable key deletes it from the merged object) are checked here
// too — the schema cannot, because in the update schema they are optional.
func RefineServiceMergedState(e *Errors, state *gen.UpdateServiceInput) {
	if state.Title == nil {
		e.Add("title", "Required")
	}
	if state.DefaultPrice == nil {
		e.Add("defaultPrice", "Required")
	}
	if state.DefaultCapacity == nil {
		e.Add("defaultCapacity", "Required")
	}
	if state.DefaultDurationMinutes == nil {
		e.Add("defaultDurationMinutes", "Required")
	}
	if state.MaxSeatsPerBooking == nil {
		e.Add("maxSeatsPerBooking", "Required")
	}
	refineServiceOptions(e, state.Options, state.OptionsSelectMode)
}

// RefineOrganizerMergedState — same non-nullable-present checks for the
// organizer profile update.
func RefineOrganizerMergedState(e *Errors, state *gen.UpdateOrganizerProfileInput) {
	if state.Name == nil {
		e.Add("name", "Required")
	}
	if state.Slug == nil {
		e.Add("slug", "Required")
	}
	if state.Timezone == nil {
		e.Add("timezone", "Required")
	}
}

// RefineSlotMergedState — same for the slot update; startsAt is only
// checked against the past when the patch actually touched it (a merged
// state always carries the current value, which may legitimately be past).
func RefineSlotMergedState(e *Errors, state *gen.UpdateTimeSlotInput, startsAtTouched bool) {
	if state.StartsAt == nil {
		e.Add("startsAt", "Required")
	}
	if state.DurationMinutes == nil {
		e.Add("durationMinutes", "Required")
	}
	if state.Capacity == nil {
		e.Add("capacity", "Required")
	}
	if startsAtTouched && state.StartsAt != nil {
		refineSlotStart(e, *state.StartsAt)
	}
}

// refineSlotStart rejects a start in the past (beyond the tolerance window).
func refineSlotStart(e *Errors, startsAt gen.SlotStartsAt) {
	raw, err := startsAt.MarshalJSON()
	if err != nil {
		return // the spec's oneOf already rejected anything unparseable
	}
	ft, err := contracts.FlexTimeFromRaw(raw)
	if err != nil {
		return
	}
	if !isAcceptableSlotStart(ft.Time()) {
		e.Add("startsAt", contracts.SlotStartInPastMessage)
	}
}
