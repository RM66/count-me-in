package contracts

import (
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"

	gen "countmein/pkg/api/gen"
)

// Hand-written domain logic: mirrors TypeScript in packages/contracts/src that
// cannot be derived from the OpenAPI spec (ADR-016). Pinned by
// packages/contracts/vectors/domain/* (vitest + go test).

func IsAppLocale(v string) bool {
	for _, l := range Locales {
		if v == l {
			return true
		}
	}
	return false
}

func IsDemoOrganizerID(organizerID string) bool {
	return organizerID == DemoOrganizerID
}

func CancelNotificationRecipient(by gen.CancelActor) gen.NotificationRecipient {
	if by == gen.CancelActorGuest {
		return gen.NotificationRecipientOrganizer
	}
	return gen.NotificationRecipientGuest
}

func LoginLinkKey(token string) string {
	return LoginLinkKeyPrefix + token
}

// SeatsLeft is remaining seats, floored at zero.
func SeatsLeft(capacity, bookedCount int) int {
	if left := capacity - bookedCount; left > 0 {
		return left
	}
	return 0
}

// SlotPrice is a slot's own price override, else the service default.
func SlotPrice(slotPrice *string, serviceDefaultPrice string) string {
	if slotPrice != nil {
		return *slotPrice
	}
	return serviceDefaultPrice
}

// EffectiveLocation — a service may override its organizer's location.
func EffectiveLocation(service, organizer *string) *string {
	if service != nil {
		return service
	}
	return organizer
}

// EffectiveContact — same inheritance rule as location.
func EffectiveContact(service, organizer *string) *string {
	if service != nil {
		return service
	}
	return organizer
}

// ValidateSelectedOptions checks a booking's selectedOptions against a concrete service.
// Mirror of buildSelectedOptionsSchema in packages/contracts/src/options.ts —
// error strings are intentionally identical; parity is pinned by the
// validateSelectedOptions domain vectors.
func ValidateSelectedOptions(serviceOptions []string, selectMode gen.OptionsSelectMode, selected []string) ([]string, error) {
	allowed := make(map[string]bool, len(serviceOptions))
	for _, o := range serviceOptions {
		allowed[o] = true
	}

	if len(allowed) == 0 {
		if len(selected) > 0 {
			return nil, errors.New("this service has no options to select")
		}
		return nil, nil
	}

	seen := make(map[string]bool, len(selected))
	for _, v := range selected {
		if seen[v] {
			return nil, errors.New("selectedOptions must not contain duplicates")
		}
		seen[v] = true
	}
	for _, v := range selected {
		if !allowed[v] {
			return nil, fmt.Errorf("option %q is not offered by this service", v)
		}
	}
	if selectMode == gen.Single && len(selected) > 1 {
		return nil, errors.New("this service allows selecting only one option")
	}
	if len(selected) == 0 {
		return nil, nil
	}
	return selected, nil
}

// MatchLocale finds the first supported locale in an Accept-Language string.
// Mirror of matchLocale in packages/contracts/src/i18n.ts (RFC 9110: absent or
// malformed q means 1, q=0 is unacceptable, higher q first, list order breaks
// ties via stable sort). Parity pinned by the matchLocale domain vectors.
func MatchLocale(acceptLanguage string) (locale string, ok bool) {
	if acceptLanguage == "" {
		return "", false
	}

	type entry struct {
		tag string
		q   float64
	}

	var weighted []entry
	for _, part := range strings.Split(acceptLanguage, ",") {
		segments := strings.SplitN(part, ";", 2)
		tag := strings.ToLower(strings.TrimSpace(segments[0]))
		q := 1.0
		if len(segments) == 2 {
			for _, param := range strings.Split(segments[1], ";") {
				if v, ok := parseQParam(strings.TrimSpace(param)); ok {
					q = v
					break // first q= wins, mirroring TS params.find
				}
			}
		}
		if q > 0 {
			weighted = append(weighted, entry{tag: tag, q: q})
		}
	}
	sort.SliceStable(weighted, func(i, j int) bool { return weighted[i].q > weighted[j].q })

	for _, e := range weighted {
		if e.tag == "" {
			continue
		}
		if IsAppLocale(e.tag) {
			return e.tag, true
		}
		for _, l := range Locales {
			if strings.HasPrefix(e.tag, l+"-") {
				return l, true
			}
		}
	}
	return "", false
}

func parseQParam(qParam string) (float64, bool) {
	if !strings.HasPrefix(qParam, "q=") {
		return 0, false
	}
	// Mirror JS Number.parseFloat prefix semantics used by matchLocale in
	// packages/contracts/src/i18n.ts: "0.9abc" parses as 0.9, while a
	// non-numeric suffix like "oops" means absent (caller keeps q=1).
	raw := strings.TrimSpace(qParam[len("q="):])
	end := 0
	for end < len(raw) {
		c := raw[end]
		if (c >= '0' && c <= '9') || c == '.' || c == '+' || c == '-' || c == 'e' || c == 'E' {
			end++
			continue
		}
		break
	}
	if end == 0 {
		return 0, false
	}
	v, err := strconv.ParseFloat(raw[:end], 64)
	if err != nil {
		return 0, false
	}
	return v, true
}
