package validation

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"testing"
	"time"

	"countmein/pkg/contracts"
)

type vectorCase struct {
	Name        string            `json:"name"`
	Body        json.RawMessage   `json:"body"`
	Valid       *bool             `json:"valid"`
	FieldErrors []string          `json:"fieldErrors"`
	FormErrors  *int              `json:"formErrors"`
	Skip        map[string]string `json:"skip"`
}

type vectorFile struct {
	Schema string       `json:"schema"`
	Cases  []vectorCase `json:"cases"`
}

var nowMarker = regexp.MustCompile(`^\$now([+-]\d+)(s|m|h|d)$`)

// Schema dispatch is the generated Parsers table — a new input works in the
// vectors with no test edit.

func replaceNowMarkers(v any) any {
	switch t := v.(type) {
	case string:
		m := nowMarker.FindStringSubmatch(t)
		if m == nil {
			return t
		}
		amount, _ := strconv.Atoi(m[1])
		var d time.Duration
		switch m[2] {
		case "s":
			d = time.Duration(amount) * time.Second
		case "m":
			d = time.Duration(amount) * time.Minute
		case "h":
			d = time.Duration(amount) * time.Hour
		case "d":
			d = time.Duration(amount) * 24 * time.Hour
		}
		return contracts.ISODate(time.Now().Add(d))
	case []any:
		for i, item := range t {
			t[i] = replaceNowMarkers(item)
		}
		return t
	case map[string]any:
		for k, item := range t {
			t[k] = replaceNowMarkers(item)
		}
		return t
	default:
		return v
	}
}

func TestValidationVectors(t *testing.T) {
	dir := filepath.Join("..", "..", "..", "..", "packages", "contracts", "vectors", "validation")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read vectors dir: %v", err)
	}
	for _, entry := range entries {
		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			t.Fatalf("read %s: %v", entry.Name(), err)
		}
		var vf vectorFile
		if err := json.Unmarshal(data, &vf); err != nil {
			t.Fatalf("parse %s: %v", entry.Name(), err)
		}
		parse, ok := Parsers[vf.Schema]
		if !ok {
			t.Errorf("no parser dispatch for schema %s", vf.Schema)
			continue
		}
		for _, c := range vf.Cases {
			if reason, skip := c.Skip["go"]; skip {
				t.Logf("skip %s/%s: %s", vf.Schema, c.Name, reason)
				continue
			}
			var body any
			if err := json.Unmarshal(c.Body, &body); err != nil {
				t.Errorf("%s/%s: bad body JSON: %v", vf.Schema, c.Name, err)
				continue
			}
			rebodied, _ := json.Marshal(replaceNowMarkers(body))
			_, errs := parse(rebodied)
			valid := errs == nil
			if c.Valid != nil && valid != *c.Valid {
				t.Errorf("%s/%s: valid=%v, want %v (errs %+v)", vf.Schema, c.Name, valid, *c.Valid, errs)
			}
			if c.FieldErrors != nil {
				var keys []string
				if errs != nil {
					for k := range errs.Fields {
						keys = append(keys, k)
					}
				}
				sort.Strings(keys)
				want := append([]string{}, c.FieldErrors...)
				sort.Strings(want)
				if len(keys) != len(want) {
					t.Errorf("%s/%s: fieldErrors=%v, want %v", vf.Schema, c.Name, keys, want)
				} else {
					for i := range keys {
						if keys[i] != want[i] {
							t.Errorf("%s/%s: fieldErrors=%v, want %v", vf.Schema, c.Name, keys, want)
							break
						}
					}
				}
			}
			if c.FormErrors != nil {
				got := 0
				if errs != nil {
					got = len(errs.Form)
				}
				if got != *c.FormErrors {
					t.Errorf("%s/%s: formErrors=%d, want %d", vf.Schema, c.Name, got, *c.FormErrors)
				}
			}
		}
	}
}
