package validation

import "testing"

// TimezoneRule must accept real IANA ids on runtimes without system tzdata
// (Vercel containers); the embedded tz database (rules.go `_ "time/tzdata"`)
// is what makes time.LoadLocation succeed there. A regression that drops the
// import turns every non-UTC registration into a 400.
func TestTimezoneRuleIANA(t *testing.T) {
	for _, zone := range []string{"Europe/Belgrade", "America/New_York", "Asia/Tokyo", "europe/belgrade"} {
		if msg := TimezoneRule(zone); msg != "" {
			t.Errorf("TimezoneRule(%q) = %q, want accept", zone, msg)
		}
	}
	for _, zone := range []string{"", "Mars/Olympus", "Local"} {
		if msg := TimezoneRule(zone); msg == "" {
			t.Errorf("TimezoneRule(%q) accepted, want reject", zone)
		}
	}
}
