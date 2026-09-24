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
	for _, name := range []string{"AUTH_SECRET", "POSTGRES_URL", "REDIS_URL", "APP_URL", "QSTASH_TOKEN"} {
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

func TestValidateVercelEnvCountsAsProduction(t *testing.T) {
	fullProdEnv(t)
	t.Setenv("NODE_ENV", "")
	t.Setenv("VERCEL_ENV", "production")
	t.Setenv("APP_URL", "")
	if err := Validate(); err == nil {
		t.Fatal("VERCEL_ENV=production without APP_URL must fail validation")
	}
}
