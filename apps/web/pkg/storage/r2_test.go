package storage

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"
)

// the signed-upload seam. The presign is computed locally (no
// network), so the success path is a pure unit test; the missing-creds
// path must be a clear error, not a panic — the route surfaces it as a
// 500 with the variable name, which is the operator's only clue.

// resetR2 clears the package-level config/presigner caches so each test
// controls the env it sees. Test-only: same package, direct var access.
func resetR2() {
	cfgOnce = sync.Once{}
	cfg = r2Config{}
	cfgErr = nil
	presignOnce = sync.Once{}
	presignClient = nil
}

func TestSignedUploadURLMissingEnvIsErrorNotPanic(t *testing.T) {
	resetR2()
	t.Setenv("R2_ACCOUNT_ID", "")
	t.Setenv("R2_ACCESS_KEY_ID", "")
	t.Setenv("R2_SECRET_ACCESS_KEY", "")
	t.Setenv("R2_BUCKET", "")
	t.Setenv("R2_PUBLIC_BASE_URL", "")

	defer resetR2()
	_, _, err := SignedUploadURL(context.Background(), "organizers/o1/avatar.png", "image/png", 1024)
	if err == nil {
		t.Fatal("missing R2 env must be an error")
	}
	if !strings.Contains(err.Error(), "R2_") {
		t.Errorf("the error must name the missing variable, got %q", err.Error())
	}
}

func TestSignedUploadURLShape(t *testing.T) {
	resetR2()
	t.Setenv("R2_ACCOUNT_ID", "test-account")
	t.Setenv("R2_ACCESS_KEY_ID", "test-key")
	t.Setenv("R2_SECRET_ACCESS_KEY", "test-secret")
	t.Setenv("R2_BUCKET", "test-bucket")
	t.Setenv("R2_PUBLIC_BASE_URL", "https://media.example.com")
	defer resetR2()

	before := time.Now()
	url, expiresAt, err := SignedUploadURL(context.Background(),
		"organizers/o1/avatar.png", "image/webp", 2048)
	if err != nil {
		t.Fatalf("presign with full env: %v", err)
	}

	// Path-style R2 endpoint, the bucket and the key in the path.
	if !strings.HasPrefix(url, "https://test-account.r2.cloudflarestorage.com/test-bucket/organizers/o1/avatar.png") {
		t.Errorf("upload URL = %q, want the R2 path-style endpoint with bucket and key", url)
	}
	// The signature pins content type and length — the browser PUT must
	// match them exactly or R2 rejects it.
	if !strings.Contains(url, "X-Amz-Signature=") {
		t.Errorf("upload URL must be signed, got %q", url)
	}
	if !strings.Contains(url, "X-Amz-Expires=600") {
		t.Errorf("upload URL must expire in 600s, got %q", url)
	}
	// The returned expiry matches the 10-minute presign window.
	maxAge := time.Until(expiresAt)
	if maxAge <= 0 || maxAge > 10*time.Minute || expiresAt.Before(before) {
		t.Errorf("expiresAt = %v, want ~now+10min", expiresAt)
	}
}
