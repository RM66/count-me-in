package i18n

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The ApiErrors corpus must cover every key the Go API can render:
// a key used in a route but missing from a locale silently falls back
// to English (or worse, to the raw key). This test scans the Go
// sources for the error-key call sites and checks each key against
// every locale in the generated corpus.
//
// The scan is deliberately a regex over source text, not AST parsing:
// the call shapes are few and uniform (httpx.Error / ErrorParams /
// ErrorExtras / i18n.ApiError with a string-literal key), and a false
// positive only ever adds a key that must exist anyway.

// errorKeyRe matches the real error-render call shapes, all of which
// name the locale variable explicitly before the key:
//
//	Error(status, locale, "key")
//	ErrorParams(status, locale, "key", params)
//	ErrorExtras(status, locale, "key", params, extras)
//	ApiError(locale, "key", params)
//
// Anything else (logx.Error with a fields map, computed keys) does not
// match — a computed key cannot be checked statically.
var errorKeyRe = regexp.MustCompile(`(?:Error|ErrorParams|ErrorExtras)\([^)]*locale, "([a-zA-Z][a-zA-Z0-9]*)"|ApiError\(locale, "([a-zA-Z][a-zA-Z0-9]*)"`)

// keyFromMatch pulls the key out of the regex capture groups (one
// alternative per call shape).
func keyFromMatch(match []string) string {
	for _, g := range match[1:] {
		if g != "" {
			return g
		}
	}
	return ""
}

func TestApiErrorKeysComplete(t *testing.T) {
	keys := collectErrorKeys(t)
	if len(keys) == 0 {
		t.Fatal("no error keys found — the source scan is broken")
	}

	for locale := range apiErrors {
		dict := apiErrors[locale]
		for key := range keys {
			if _, ok := dict[key]; !ok {
				t.Errorf("locale %q is missing ApiErrors key %q", locale, key)
			}
		}
	}
}

// collectErrorKeys walks the Go packages that render API errors and
// returns the set of string-literal keys found at call sites.
func collectErrorKeys(t *testing.T) map[string]bool {
	t.Helper()
	// The test runs in pkg/i18n; the callers live in sibling packages.
	roots := []string{"../httpx", "../routes", "../jobs", "."}
	keys := map[string]bool{}
	for _, root := range roots {
		abs, err := filepath.Abs(root)
		if err != nil {
			t.Fatal(err)
		}
		err = filepath.WalkDir(abs, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
				return nil
			}
			raw, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			for _, match := range errorKeyRe.FindAllStringSubmatch(string(raw), -1) {
				if key := keyFromMatch(match); key != "" {
					keys[key] = true
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	return keys
}
