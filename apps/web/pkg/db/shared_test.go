package db

import (
	"strings"
	"testing"
)

func TestParseStringArray(t *testing.T) {
	if got := parseStringArray(nil); got != nil {
		t.Fatalf("NULL → nil, got %v", got)
	}
	if got := parseStringArray(strPtr("null")); got != nil {
		t.Fatalf("'null' → nil, got %v", got)
	}
	got := parseStringArray(strPtr(`["a","b c","d"]`))
	if len(got) != 3 || got[0] != "a" || got[1] != "b c" || got[2] != "d" {
		t.Fatalf("array parse: %v", got)
	}
	if got := parseStringArray(strPtr("[]")); len(got) != 0 {
		t.Fatalf("empty array: %v", got)
	}
}

func TestNewServiceIDShape(t *testing.T) {
	const nanoidAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
	for i := 0; i < 100; i++ {
		id := newServiceID()
		if len(id) != 21 {
			t.Fatalf("nanoid length must be 21, got %d (%q)", len(id), id)
		}
		for _, c := range id {
			if !strings.ContainsRune(nanoidAlphabet, c) {
				t.Fatalf("nanoid charset violation: %q", id)
			}
		}
	}
}

func TestNewManageTokenShape(t *testing.T) {
	token := newManageToken()
	// 32 bytes → 43 base64url chars (never typed by hand).
	if len(token) != 43 {
		t.Fatalf("manageToken must be 43 chars, got %d (%q)", len(token), token)
	}
	if strings.ContainsAny(token, "+/") {
		t.Fatalf("manageToken must be URL-safe: %q", token)
	}
}
