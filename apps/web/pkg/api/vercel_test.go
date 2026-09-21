package api

import (
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"

	gen "countmein/pkg/api/gen"
)

// The generated router guarantees that every spec operation is dispatched,
// and the Go entry point restores the original path from ?_path. What the
// compiler cannot see is whether vercel.json actually rewrites every API
// path to /api/entry — a missing rewrite is a 404 in production with a
// green build (the old check:api-routes script covered this; it was
// replaced by the generated mux, which does not).
//
// The check is deliberately pattern-based, not an exact match: vercel.json
// uses /api/organizers/:path* rewrites for whole subtrees, so a new
// /api/organizers/... path needs no edit while a new top-level /api/...
// prefix does.

// specPathLine matches a top-level key of the OpenAPI `paths` map at the
// two-space indent the generator emits (e.g. `  /api/services/{id}:`).
var specPathLine = regexp.MustCompile(`(?m)^  (/api/[^:\n]+):$`)

// specPaths reads the committed spec (the same YAML embedded in
// gen/spec_gen.go) and returns its path keys.
func specPaths(t *testing.T) map[string]bool {
	t.Helper()
	data, err := os.ReadFile("../../openapi.yaml")
	if err != nil {
		t.Fatalf("read spec: %v", err)
	}
	paths := map[string]bool{}
	for _, m := range specPathLine.FindAllStringSubmatch(string(data), -1) {
		paths[m[1]] = true
	}
	if len(paths) == 0 {
		t.Fatal("no /api paths found in the spec")
	}
	if !paths["/api/jobs/{queue}"] {
		t.Fatalf("spec path extraction looks wrong — /api/jobs/{queue} missing from %v", paths)
	}
	return paths
}

// vercelRewrites reads the Vercel configuration's rewrite sources.
func vercelRewrites(t *testing.T) []string {
	t.Helper()
	data, err := os.ReadFile("../../vercel.json")
	if err != nil {
		t.Fatalf("read vercel.json: %v", err)
	}
	var cfg struct {
		Rewrites []struct {
			Source      string `json:"source"`
			Destination string `json:"destination"`
		} `json:"rewrites"`
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("parse vercel.json: %v", err)
	}
	if len(cfg.Rewrites) == 0 {
		t.Fatal("vercel.json declares no rewrites")
	}
	sources := make([]string, 0, len(cfg.Rewrites))
	for _, rw := range cfg.Rewrites {
		if rw.Destination != "/api/entry?_path="+rw.Source {
			t.Errorf("rewrite %s must carry the original path as ?_path (got %q)", rw.Source, rw.Destination)
		}
		sources = append(sources, rw.Source)
	}
	return sources
}

// rewriteRegex converts a vercel.json source pattern into a regexp with
// Vercel's semantics: ":path*" matches zero or more segments (so
// /api/services/:path* also covers the bare /api/services), ":name"
// matches exactly one.
func rewriteRegex(source string) *regexp.Regexp {
	var b strings.Builder
	b.WriteString("^")
	for _, seg := range strings.Split(source, "/") {
		if seg == "" {
			continue
		}
		switch {
		case strings.HasPrefix(seg, ":"):
			name := strings.TrimPrefix(seg, ":")
			b.WriteString("(?:/")
			if strings.HasSuffix(name, "*") {
				b.WriteString(".+")
			} else {
				b.WriteString("[^/]+")
			}
			b.WriteString(")")
			if strings.HasSuffix(name, "*") {
				b.WriteString("?")
			}
		default:
			b.WriteString("/")
			b.WriteString(regexp.QuoteMeta(seg))
		}
	}
	b.WriteString("$")
	return regexp.MustCompile(b.String())
}

func TestVercelRewritesCoverSpecPaths(t *testing.T) {
	rewrites := vercelRewrites(t)
	paths := specPaths(t)

	for path := range paths {
		matched := false
		for _, source := range rewrites {
			if rewriteRegex(source).MatchString(path) {
				matched = true
				break
			}
		}
		if !matched {
			t.Errorf("spec path %s has no vercel.json rewrite — production would 404; add one", path)
		}
	}
}

// TestMuxCoversSpecPaths: the generated router is built from the same
// embedded spec, so both must agree on the dispatched surface.
func TestMuxCoversSpecPaths(t *testing.T) {
	paths := specPaths(t)
	swagger, err := gen.GetSwagger()
	if err != nil {
		t.Fatalf("load embedded spec: %v", err)
	}
	if got, want := len(swagger.Paths.Map()), len(paths); got != want {
		t.Errorf("embedded spec paths = %d, committed spec paths = %d", got, want)
	}
}
