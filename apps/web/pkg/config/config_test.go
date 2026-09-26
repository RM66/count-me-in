package config

import (
	"strings"
	"testing"
)

// fail-fast production config. Load is not unit-testable where it
// calls os.Exit, but Validate is pure: in production every missing
// variable is a hard error naming it; outside production validation is
// skipped (local docker-compose routinely lacks secrets — the lazy
// per-package panics still surface them at first use).

func clearProdFlags(t *testing.T) {
	t.Helper()
	t.Setenv("NODE_ENV", "test")
	t.Setenv("VERCEL_ENV", "")
}

func fullProdEnv(t *testing.T) {
	t.Helper()
	t.Setenv("NODE_ENV", "production")
	t.Setenv("VERCEL_ENV", "")
	t.Setenv("AUTH_SECRET", "prod-secret")
	t.Setenv("POSTGRES_URL", "postgres://prod/db")
	t.Setenv("REDIS_URL", "redis://prod")
	t.Setenv("APP_URL", "https://countmein.group")
	t.Setenv("QSTASH_TOKEN", "prod-qstash-token")
	t.Setenv("QSTASH_CURRENT_SIGNING_KEY", "prod-signing-key")
	t.Setenv("TELEGRAM_BOT_TOKEN", "prod-bot-token")
}

func TestValidateSkippedOutsideProduction(t *testing.T) {
	clearProdFlags(t)
	t.Setenv("AUTH_SECRET", "")
	t.Setenv("POSTGRES_URL", "")
	if err := Validate(); err != nil {
		t.Fatalf("outside production validation must be skipped, got %v", err)
	}
}

func TestValidateProductionFull(t *testing.T) {
	fullProdEnv(t)
	if err := Validate(); err != nil {
		t.Fatalf("complete production env must validate, got %v", err)
	}
}

func TestValidateProductionRefusals(t *testing.T) {
	for _, name := range []string{"AUTH_SECRET", "POSTGRES_URL", "REDIS_URL", "APP_URL", "QSTASH_TOKEN", "QSTASH_CURRENT_SIGNING_KEY", "TELEGRAM_BOT_TOKEN"} {
		t.Run(name, func(t *testing.T) {
			fullProdEnv(t)
			t.Setenv(name, "  ") // whitespace-only counts as missing
			err := Validate()
			if err == nil {
				t.Fatalf("production without %s must fail validation", name)
			}
			if !strings.Contains(err.Error(), name) {
				t.Errorf("error = %q, want it to name %q", err.Error(), name)
			}
		})
	}
}

func TestValidateAppURLShapes(t *testing.T) {
	for _, tc := range []struct {
		name    string
		appURL  string
		wantErr bool
	}{
		{"host only", "https://countmein.group", false},
		{"trailing slash", "https://countmein.group/", false},
		{"http allowed", "http://localhost:3000", false},
		{"trailing path", "https://countmein.group/some/path", true},
		{"query string", "https://countmein.group?x=1", true},
		{"fragment", "https://countmein.group#frag", true},
		{"userinfo", "https://user:pass@countmein.group", true},
		{"no scheme", "countmein.group", true},
		{"wrong scheme", "ftp://countmein.group", true},
		{"empty host", "https://", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fullProdEnv(t)
			t.Setenv("APP_URL", tc.appURL)
			err := Validate()
			if tc.wantErr && err == nil {
				t.Fatalf("APP_URL=%q must fail validation", tc.appURL)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("APP_URL=%q must validate, got %v", tc.appURL, err)
			}
		})
	}
}

func TestValidateStrictEnvOptsIn(t *testing.T) {
	// Dev/staging can opt into the production validation with STRICT_ENV=1;
	// without it (and outside production) validation stays skipped.
	t.Setenv("STRICT_ENV", "")
	clearProdFlags(t)
	t.Setenv("AUTH_SECRET", "")
	if err := Validate(); err != nil {
		t.Fatalf("outside production without STRICT_ENV must skip validation, got %v", err)
	}

	t.Setenv("STRICT_ENV", "1")
	if err := Validate(); err == nil {
		t.Fatal("STRICT_ENV=1 must enforce validation outside production")
	}
	fullProdEnv(t)
	if err := Validate(); err != nil {
		t.Fatalf("full env under STRICT_ENV=1 must validate, got %v", err)
	}
}

func TestValidateNextSigningKeyOptional(t *testing.T) {
	fullProdEnv(t)
	t.Setenv("QSTASH_NEXT_SIGNING_KEY", "")
	if err := Validate(); err != nil {
		t.Fatalf("empty QSTASH_NEXT_SIGNING_KEY must validate (rotation only), got %v", err)
	}
}

func TestValidateVercelEnvCountsAsProduction(t *testing.T) {
	fullProdEnv(t)
	t.Setenv("NODE_ENV", "")
	t.Setenv("VERCEL_ENV", "production")
	t.Setenv("APP_URL", "")
	if err := Validate(); err == nil {
		t.Fatal("VERCEL_ENV=production without APP_URL must fail validation")
	}
}
