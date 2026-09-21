package routes

import (
	"encoding/json"
	"testing"

	gen "countmein/pkg/api/gen"
	"countmein/pkg/db"
)

// The merge-patch base for a service, mirroring serviceWritableState's
// shape (the same field set the DB row renders).
func serviceStateFixture() map[string]any {
	mode := "single"
	return map[string]any{
		"title":                  "Yoga",
		"description":            "Morning flow",
		"location":               nil,
		"contact":                nil,
		"defaultPrice":           "10",
		"defaultCapacity":        8,
		"defaultDurationMinutes": 60,
		"maxSeatsPerBooking":     2,
		"options":                []string{"A", "B"},
		"optionsSelectMode":      mode,
		"photoUrl":               nil,
	}
}

// A merge patch that clears the options pair: both keys must be sent as
// null (routes.ts documents the pair rule), and the merged state must
// carry neither — which is what makes RefineServiceMergedState pass and
// the DB write NULL into both columns.
func TestMergePatchClearsOptionsPair(t *testing.T) {
	merged, err := mergePatch(serviceStateFixture(), []byte(`{"options":null,"optionsSelectMode":null}`))
	if err != nil {
		t.Fatalf("mergePatch: %v", err)
	}

	var state gen.UpdateServiceInput
	if err := json.Unmarshal(merged, &state); err != nil {
		t.Fatalf("unmarshal merged state: %v", err)
	}
	if state.Options != nil || state.OptionsSelectMode != nil {
		t.Fatalf("options pair must be cleared, got options=%v mode=%v", state.Options, state.OptionsSelectMode)
	}
	// Untouched fields survive the merge.
	if state.Title == nil || *state.Title != "Yoga" {
		t.Fatalf("untouched title must survive, got %v", state.Title)
	}
	if state.DefaultCapacity == nil || *state.DefaultCapacity != 8 {
		t.Fatalf("untouched defaultCapacity must survive, got %v", state.DefaultCapacity)
	}
}

// Absent keys keep the current value (the RFC 7386 half that makes a
// partial update possible at all).
func TestMergePatchKeepsAbsentKeys(t *testing.T) {
	merged, err := mergePatch(serviceStateFixture(), []byte(`{"defaultPrice":"20"}`))
	if err != nil {
		t.Fatalf("mergePatch: %v", err)
	}

	var state gen.UpdateServiceInput
	if err := json.Unmarshal(merged, &state); err != nil {
		t.Fatalf("unmarshal merged state: %v", err)
	}
	if state.DefaultPrice == nil || *state.DefaultPrice != "20" {
		t.Fatalf("patched price must be applied, got %v", state.DefaultPrice)
	}
	if state.Options == nil || len(*state.Options) != 2 || state.OptionsSelectMode == nil {
		t.Fatalf("untouched options pair must survive, got %v / %v", state.Options, state.OptionsSelectMode)
	}
}

// patchKeys is the touched-set the DB layer writes columns from: an empty
// object and a non-object are "nothing to update" (400), a real patch
// names exactly the keys the client sent.
func TestPatchKeys(t *testing.T) {
	for name, body := range map[string]string{
		"empty":    `{}`,
		"null":     `null`,
		"not json": `not json`,
		"array":    `[]`,
		"no keys":  `{"":1}`, // still one key: the caller maps it to no columns
	} {
		if _, ok := patchKeys([]byte(body)); ok != (name == "no keys") {
			t.Errorf("patchKeys(%s) ok = %v", name, !ok)
		}
	}

	keys, ok := patchKeys([]byte(`{"title":"Yoga","options":null}`))
	if !ok {
		t.Fatal("a non-empty object is a valid patch")
	}
	if !keys["title"] || !keys["options"] || len(keys) != 2 {
		t.Fatalf("unexpected touched set: %v", keys)
	}
}

// Service rows carry options as NULL or an array; the merge base must
// round-trip both shapes without inventing an empty array.
func TestMergePatchPreservesNullOptions(t *testing.T) {
	state := serviceStateFixture()
	state["options"] = nil
	state["optionsSelectMode"] = nil

	merged, err := mergePatch(state, []byte(`{"defaultPrice":"20"}`))
	if err != nil {
		t.Fatalf("mergePatch: %v", err)
	}
	var out struct {
		Options *[]string `json:"options"`
	}
	if err := json.Unmarshal(merged, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out.Options != nil {
		t.Fatalf("nil options must stay nil, got %v", out.Options)
	}
}

// The slot merge base renders startsAt as an ISO string; a patch may
// replace it (string or epoch) but the untouched value must survive.
func TestMergePatchSlotStartsAt(t *testing.T) {
	merged, err := mergePatch(slotWritableState(db.TimeSlotRow{}), []byte(`{"capacity":12}`))
	if err != nil {
		t.Fatalf("mergePatch: %v", err)
	}
	var out map[string]json.RawMessage
	if err := json.Unmarshal(merged, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, ok := out["startsAt"]; !ok {
		t.Fatal("startsAt must survive an unrelated patch")
	}
}
