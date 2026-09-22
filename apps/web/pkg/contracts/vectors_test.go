package contracts

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	gen "countmein/pkg/api/gen"
)

func strPtr(s string) *string { return &s }

func TestDomainVectors(t *testing.T) {
	dir := filepath.Join("..", "..", "..", "..", "packages", "contracts", "vectors", "domain")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read vectors dir: %v", err)
	}
	for _, entry := range entries {
		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			t.Fatalf("read %s: %v", entry.Name(), err)
		}
		var vf struct {
			Fn    string           `json:"fn"`
			Cases []map[string]any `json:"cases"`
		}
		if err := json.Unmarshal(data, &vf); err != nil {
			t.Fatalf("parse %s: %v", entry.Name(), err)
		}
		for _, c := range vf.Cases {
			name, _ := c["name"].(string)
			switch vf.Fn {
			case "matchLocale":
				{
					input, _ := c["input"].(string)
					got, ok := MatchLocale(input)
					var want string
					if w, ok := c["expected"].(string); ok {
						want = w
					}
					wantOk := c["expected"] != nil
					if got != want || ok != wantOk {
						t.Errorf("matchLocale/%s: got (%q,%v), want (%q,%v)", name, got, ok, want, wantOk)
					}
				}
			case "validateSelectedOptions":
				{
					var serviceOptions []string
					if arr, ok := c["serviceOptions"].([]any); ok {
						for _, item := range arr {
							if s, ok := item.(string); ok {
								serviceOptions = append(serviceOptions, s)
							}
						}
					}
					// A null/absent mode must stay empty: the TS side passes null
					// through and skips the single-mode check, so defaulting to
					// OptionsSingle here would mask a regression in that branch.
					mode := gen.OptionsSelectMode("")
					if m, ok := c["selectMode"].(string); ok {
						mode = gen.OptionsSelectMode(m)
					}
					var selected []string
					if arr, ok := c["selected"].([]any); ok {
						for _, item := range arr {
							if s, ok := item.(string); ok {
								selected = append(selected, s)
							}
						}
					}
					got, err := ValidateSelectedOptions(serviceOptions, mode, selected)
					wantValid, _ := c["valid"].(bool)
					if (err == nil) != wantValid {
						t.Errorf("validateSelectedOptions/%s: valid=%v, want %v (err %v)", name, err == nil, wantValid, err)
						continue
					}
					if wantValid {
						if exp, hasExpected := c["expectedSelected"]; hasExpected {
							var want []string
							if arr, ok := exp.([]any); ok {
								for _, item := range arr {
									if s, ok := item.(string); ok {
										want = append(want, s)
									}
								}
							}
							if !reflect.DeepEqual(got, want) {
								t.Errorf("validateSelectedOptions/%s: got %v, want %v", name, got, want)
							}
						}
					}
				}
			case "seatsLeft":
				{
					got := SeatsLeft(int(c["capacity"].(float64)), int(c["bookedCount"].(float64)))
					if got != int(c["expected"].(float64)) {
						t.Errorf("seatsLeft/%s: got %d, want %v", name, got, c["expected"])
					}
				}
			case "slotPrice":
				{
					var slot *string
					if s, ok := c["slotPrice"].(string); ok {
						slot = strPtr(s)
					}
					serviceDefault, _ := c["serviceDefault"].(string)
					if got := SlotPrice(slot, serviceDefault); got != c["expected"].(string) {
						t.Errorf("slotPrice/%s: got %q, want %q", name, got, c["expected"])
					}
				}
			case "effectiveLocation":
				{
					var service, organizer *string
					if s, ok := c["service"].(string); ok {
						service = strPtr(s)
					}
					if s, ok := c["organizer"].(string); ok {
						organizer = strPtr(s)
					}
					got := EffectiveLocation(service, organizer)
					var want *string
					if s, ok := c["expected"].(string); ok {
						want = strPtr(s)
					}
					if (got == nil) != (want == nil) || (got != nil && *got != *want) {
						t.Errorf("effectiveLocation/%s: got %v, want %v", name, got, want)
					}
				}
			case "effectiveContact":
				{
					var service, organizer *string
					if s, ok := c["service"].(string); ok {
						service = strPtr(s)
					}
					if s, ok := c["organizer"].(string); ok {
						organizer = strPtr(s)
					}
					got := EffectiveContact(service, organizer)
					var want *string
					if s, ok := c["expected"].(string); ok {
						want = strPtr(s)
					}
					if (got == nil) != (want == nil) || (got != nil && *got != *want) {
						t.Errorf("effectiveContact/%s: got %v, want %v", name, got, want)
					}
				}
			case "cancelNotificationRecipient":
				{
					var by gen.CancelActor
					if c["cancelledBy"] == string(gen.CancelActorGuest) {
						by = gen.CancelActorGuest
					} else {
						by = gen.CancelActorOrganizer
					}
					if got := CancelNotificationRecipient(by); string(got) != c["expected"].(string) {
						t.Errorf("cancelNotificationRecipient/%s: got %q, want %q", name, got, c["expected"])
					}
				}
			case "loginLinkKey":
				{
					if got := LoginLinkKey(c["token"].(string)); got != c["expected"].(string) {
						t.Errorf("loginLinkKey/%s: got %q, want %q", name, got, c["expected"])
					}
				}
			case "isDemoOrganizerId":
				{
					id, _ := c["organizerId"].(string)
					if got := IsDemoOrganizerID(id); got != c["expected"].(bool) {
						t.Errorf("isDemoOrganizerId/%s: got %v, want %v", name, got, c["expected"])
					}
				}
			default:
				t.Errorf("unknown domain fn %s", vf.Fn)
			}
		}
	}
}
