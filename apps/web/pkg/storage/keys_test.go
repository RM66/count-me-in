package storage

import (
	"context"
	"testing"
)

// IsOwnMediaURL boundary cases: the check must
// accept the organizer's own directory and anything beneath it, and
// reject siblings, traversal, and foreign hosts.
func TestIsOwnMediaURL(t *testing.T) {
	// config() validates the full R2 env set before returning, so the
	// test must provide every required name — not just the public base.
	// resetR2 clears the sync.Once cache (config is process-wide), so
	// the Setenv values above take effect even when tests run together.
	resetR2()
	defer resetR2()
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

// MediaKeyFromURL is the inverse of PublicURL and gates deletion: it
// must map own URLs to keys, and refuse everything else (the directory
// itself, foreign media, garbage) so a cleanup never deletes an object
// the organizer does not own.
func TestMediaKeyFromURL(t *testing.T) {
	resetR2()
	defer resetR2()
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
		key  string
		ok   bool
	}{
		{"avatar", base + "/avatar-abcd1234.webp", "organizers/" + id + "/avatar-abcd1234.webp", true},
		{"service cover", base + "/services/photo-abcd1234.png", "organizers/" + id + "/services/photo-abcd1234.png", true},
		{"dot segments resolve", base + "/./avatar.png", "organizers/" + id + "/avatar.png", true},
		{"query string ignored", base + "/avatar.png?v=123", "organizers/" + id + "/avatar.png", true},
		{"directory itself is not an object", base, "", false},
		{"directory with slash is not an object", base + "/", "", false},
		{"foreign organizer", "https://media.example.com/organizers/other/avatar.png", "", false},
		{"foreign host", "https://evil.example.com/organizers/" + id + "/avatar.png", "", false},
		{"garbage url", "::::not-a-url", "", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			key, ok := MediaKeyFromURL(id, tc.url)
			if ok != tc.ok || key != tc.key {
				t.Errorf("MediaKeyFromURL(%q, %q) = (%q, %v), want (%q, %v)", id, tc.url, key, ok, tc.key, tc.ok)
			}
		})
	}
}

// A public base URL with its own path prefix (e.g. a /cdn mount) must
// round-trip: PublicURL prepends the prefix, MediaKeyFromURL strips it.
func TestMediaKeyFromURLWithBasePath(t *testing.T) {
	resetR2()
	defer resetR2()
	t.Setenv("R2_ACCOUNT_ID", "acc")
	t.Setenv("R2_ACCESS_KEY_ID", "key")
	t.Setenv("R2_SECRET_ACCESS_KEY", "secret")
	t.Setenv("R2_BUCKET", "bucket")
	t.Setenv("R2_PUBLIC_BASE_URL", "https://cdn.example.com/media")
	const id = "org-123"

	key, ok := MediaKeyFromURL(id, "https://cdn.example.com/media/organizers/"+id+"/avatar.png")
	if !ok || key != "organizers/"+id+"/avatar.png" {
		t.Errorf("subpath base: got (%q, %v), want (organizers/%s/avatar.png, true)", key, ok, id)
	}
	if _, ok := MediaKeyFromURL(id, "https://cdn.example.com/media/organizers/"+id); ok {
		t.Error("subpath base: the organizer directory itself must not map to a key")
	}
}

// PublicURL and MediaKeyFromURL must be exact inverses for the keys the
// upload paths generate — the cleanup depends on it (both avatars and
// service covers live under the same organizer directory).
func TestMediaKeyFromURLRoundTripsPublicURL(t *testing.T) {
	resetR2()
	defer resetR2()
	t.Setenv("R2_ACCOUNT_ID", "acc")
	t.Setenv("R2_ACCESS_KEY_ID", "key")
	t.Setenv("R2_SECRET_ACCESS_KEY", "secret")
	t.Setenv("R2_BUCKET", "bucket")
	t.Setenv("R2_PUBLIC_BASE_URL", "https://cdn.example.com/media")
	const id = "org-123"

	for _, key := range []string{AvatarKey(id, "webp"), ServicePhotoKey(id, "png")} {
		url, err := PublicURL(key)
		if err != nil {
			t.Fatalf("PublicURL(%q): %v", key, err)
		}
		got, ok := MediaKeyFromURL(id, url)
		if !ok || got != key {
			t.Errorf("round trip %q → %q: got (%q, %v), want the same key", key, url, got, ok)
		}
	}
}

// DeleteReplacedMedia's skip decisions: nothing to delete, the same URL,
// the same object behind a different spelling, or foreign media. The
// delete seam records the calls, so a regression that reaches R2 (or
// deletes the wrong key) fails here instead of in production.
func TestDeleteReplacedMedia(t *testing.T) {
	resetR2()
	defer resetR2()
	t.Setenv("R2_ACCOUNT_ID", "acc")
	t.Setenv("R2_ACCESS_KEY_ID", "key")
	t.Setenv("R2_SECRET_ACCESS_KEY", "secret")
	t.Setenv("R2_BUCKET", "bucket")
	t.Setenv("R2_PUBLIC_BASE_URL", "https://media.example.com")
	const id = "org-123"
	const base = "https://media.example.com/organizers/" + id

	var deleted []string
	orig := deleteObject
	deleteObject = func(_ context.Context, key string) error {
		deleted = append(deleted, key)
		return nil
	}
	defer func() { deleteObject = orig }()

	ctx := context.Background()
	skips := []struct {
		name   string
		oldURL string
		newURL string
	}{
		{"nothing to delete", "", base + "/avatar.png"},
		{"unchanged url", base + "/avatar.png", base + "/avatar.png"},
		{"cache buster on the unchanged url", base + "/avatar.png?v=1", base + "/avatar.png?v=1"},
		{"same object behind a cache buster", base + "/avatar.png?v=1", base + "/avatar.png?v=2"},
		{"same object behind an encoded path", base + "/ava%74ar.png", base + "/avatar.png"},
		{"foreign host", "https://evil.example.com/organizers/" + id + "/avatar.png", base + "/avatar.png"},
		{"foreign organizer", "https://media.example.com/organizers/other/avatar.png", base + "/avatar.png"},
		{"malformed url", "::::not-a-url", base + "/avatar.png"},
		{"directory is not an object", base, base + "/avatar.png"},
	}
	for _, tc := range skips {
		DeleteReplacedMedia(ctx, id, tc.oldURL, tc.newURL)
		if len(deleted) != 0 {
			t.Fatalf("%s: must not delete, got %v", tc.name, deleted)
		}
	}

	DeleteReplacedMedia(ctx, id, base+"/avatar-abcd1234.webp?v=9", base+"/services/photo-ffff.png")
	if len(deleted) != 1 || deleted[0] != "organizers/"+id+"/avatar-abcd1234.webp" {
		t.Fatalf("replaced avatar must be deleted by key, got %v", deleted)
	}
}

// Without the R2 env set the cleanup must report a storage error and
// never attempt the delete — the skip used to be logged as foreign
// media, which hid a misconfiguration.
func TestDeleteReplacedMediaUnconfiguredStorage(t *testing.T) {
	resetR2()
	defer resetR2()
	t.Setenv("R2_ACCOUNT_ID", "")
	t.Setenv("R2_ACCESS_KEY_ID", "")
	t.Setenv("R2_SECRET_ACCESS_KEY", "")
	t.Setenv("R2_BUCKET", "")
	t.Setenv("R2_PUBLIC_BASE_URL", "")

	orig := deleteObject
	deleteObject = func(context.Context, string) error {
		t.Fatal("no delete attempt is possible without config")
		return nil
	}
	defer func() { deleteObject = orig }()

	const id = "org-123"
	DeleteReplacedMedia(context.Background(), id,
		"https://media.example.com/organizers/"+id+"/avatar.png",
		"https://media.example.com/organizers/"+id+"/avatar-2.png")
}
