package storage

import "testing"

// IsOwnMediaURL boundary cases: the check must
// accept the organizer's own directory and anything beneath it, and
// reject siblings, traversal, and foreign hosts.
func TestIsOwnMediaURL(t *testing.T) {
	// config() validates the full R2 env set before returning, so the
	// test must provide every required name — not just the public base.
	t.Setenv("R2_ACCOUNT_ID", "acc")
	t.Setenv("R2_ACCESS_KEY_ID", "key")
	t.Setenv("R2_SECRET_ACCESS_KEY", "secret")
	t.Setenv("R2_BUCKET", "bucket")
	t.Setenv("R2_PUBLIC_BASE_URL", "https://media.example.com")
	const id = "org-123"
	const base = "https://media.example.com/organizers/" + id

	cases := []struct {
		name string
		url  string
		want bool
	}{
		{"exact directory", base, true},
		{"file inside directory", base + "/avatar.png", true},
		{"nested file", base + "/services/s1/photo.png", true},
		{"trailing slash stays inside", base + "/", true},
		{"sibling prefix must not match", "https://media.example.com/organizers/" + id + "-evil/avatar.png", false},
		{"parent directory", "https://media.example.com/organizers/other/photo.png", false},
		{"traversal via dotdot", base + "/../other/photo.png", false},
		{"traversal encoded in path", "https://media.example.com/organizers/../other/photo.png", false},
		{"dot segment", base + "/./avatar.png", true},
		{"foreign host", "https://evil.example.com/organizers/" + id + "/avatar.png", false},
		{"garbage url", "::::not-a-url", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsOwnMediaURL(id, tc.url); got != tc.want {
				t.Errorf("IsOwnMediaURL(%q, %q) = %v, want %v", id, tc.url, got, tc.want)
			}
		})
	}
}
