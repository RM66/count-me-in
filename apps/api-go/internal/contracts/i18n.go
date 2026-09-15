package contracts

import (
	"sort"
	"strconv"
	"strings"
)

// MatchLocale finds the first supported locale in an Accept-Language
// string, honoring q weights (higher first, list order breaking ties,
// q=0 unacceptable); ok=false when nothing matches. Port of matchLocale
// in packages/contracts (RFC 9110 semantics).
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
		q := 1.0 // absent or malformed q means full preference (RFC 9110)
		if len(segments) == 2 {
			for _, param := range strings.Split(segments[1], ";") {
				if v, ok := parseQParam(strings.TrimSpace(param)); ok {
					q = v
				}
			}
		}
		if q > 0 {
			weighted = append(weighted, entry{tag: tag, q: q})
		}
	}
	// Stable sort keeps list order for equal q — the TS tiebreak (index).
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

func parseQParam(param string) (float64, bool) {
	if !strings.HasPrefix(param, "q=") {
		return 0, false
	}
	v, err := strconv.ParseFloat(param[len("q="):], 64)
	if err != nil {
		return 0, false
	}
	return v, true
}
