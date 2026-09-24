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

// HashManageToken parity vectors: the same SHA-256 hex as the TS helper
// (@repo/contracts/manage-token) and the SQL lookup key — pinned on both
// sides of the wire (manage-token.test.ts carries the same table). The
// cases cover the shapes a token can plausibly take: empty, short,
// unicode/emoji, and both ends of the length spectrum.
func TestHashManageTokenParity(t *testing.T) {
	cases := []struct{ token, want string }{
		{"countmein-parity-vector", "fdacba0aa4450ff1b8a7a6c94795723794dc2987dac5bb0b2f81f6cadfd9f7a4"},
		{"", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"},
		{"0123456789", "84d89877f0d4041efb6bf91a16f0248f2fd573e6af05c19f96bedb9f882f7882"},
		{"токен-🔑-парity", "af5cd9735dddab01d8c050b125086b0e655cdbb63c2b462d4f7fa1090cb606c0"},
		{strings.Repeat("A", 64), "d53eda7a637c99cc7fb566d96e9fa109bf15c478410a3f5eb4d4c4e26cd081f6"},
		{strings.Repeat("A", 256), "e075f2f51cad23d0537186cfcd50f911ea954f9c2e32a437f45327f1b7899bbb"},
	}
	for _, c := range cases {
		if got := HashManageToken(c.token); got != c.want {
			t.Errorf("HashManageToken(%q) = %q, want %q", c.token, got, c.want)
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
