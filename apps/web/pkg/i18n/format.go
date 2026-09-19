package i18n

import (
	"fmt"
	"strconv"
	"strings"
)

// Format renders an ICU message with params — the subset the app's
// translations use: `{name}` placeholders and
// `{name, plural, =1 {…} one {…} other {…}}` clauses (with `#` inside
// clauses standing for the number). `select` and other ICU features
// are not implemented (absent from the corpus) and render nothing.
func Format(msg string, locale string, params map[string]any) string {
	var sb strings.Builder
	formatInto(&sb, msg, locale, params, nil)
	return sb.String()
}

func formatInto(sb *strings.Builder, msg string, locale string, params map[string]any, pluralArg *int64) {
	i := 0
	for i < len(msg) {
		c := msg[i]
		if c == '#' && pluralArg != nil {
			sb.WriteString(strconv.FormatInt(*pluralArg, 10))
			i++
			continue
		}
		if c != '{' {
			sb.WriteByte(c)
			i++
			continue
		}

		// Placeholder: read the argument name up to ',' or '}'.
		j := i + 1
		for j < len(msg) && msg[j] != ',' && msg[j] != '}' {
			j++
		}
		if j >= len(msg) {
			sb.WriteString(msg[i:])
			return
		}
		name := msg[i+1 : j]
		if msg[j] == '}' {
			renderParam(sb, name, params)
			i = j + 1
			continue
		}

		// Complex argument: `{name, plural, <clauses>}`. Read the
		// keyword ("plural") up to the next comma.
		k := j + 1
		for k < len(msg) && msg[k] != ',' && msg[k] != '{' && msg[k] != '}' {
			k++
		}
		keyword := strings.TrimSpace(msg[j+1 : k])
		if k >= len(msg) || msg[k] != ',' {
			sb.WriteString(msg[i:])
			return
		}
		p := k + 1

		clauses := map[string]string{}
		for p < len(msg) && msg[p] != '}' {
			p = skipSpace(msg, p)
			s := p
			for p < len(msg) && msg[p] != '{' && !isSpace(msg[p]) {
				p++
			}
			selector := msg[s:p]
			p = skipSpace(msg, p)
			if p >= len(msg) || msg[p] != '{' {
				break
			}
			text, next := readBalanced(msg, p)
			clauses[selector] = text
			p = next
		}
		if p < len(msg) {
			p++ // consume the argument's closing '}'
		}

		if keyword == "plural" {
			num, hasNum := paramNumber(name, params)
			chosen, ok := "", false
			if hasNum {
				// Exact "=N" matches win over CLDR categories.
				chosen, ok = clauses["="+strconv.FormatInt(num, 10)]
				if !ok {
					chosen, ok = clauses[pluralCategory(locale, num)]
				}
			}
			if !ok {
				chosen, ok = clauses["other"]
			}
			if ok {
				formatInto(sb, chosen, locale, params, &num)
			}
		}
		i = p
	}
}

func readBalanced(msg string, start int) (text string, next int) {
	depth := 0
	for i := start; i < len(msg); i++ {
		switch msg[i] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return msg[start+1 : i], i + 1
			}
		}
	}
	return msg[start+1:], len(msg)
}

func renderParam(sb *strings.Builder, name string, params map[string]any) {
	v, ok := params[name]
	if !ok {
		// A missing param renders as-is so it stays visible in review.
		sb.WriteString("{" + name + "}")
		return
	}
	switch t := v.(type) {
	case string:
		sb.WriteString(t)
	case int:
		sb.WriteString(strconv.Itoa(t))
	case int64:
		sb.WriteString(strconv.FormatInt(t, 10))
	default:
		sb.WriteString(fmt.Sprint(v))
	}
}

func paramNumber(name string, params map[string]any) (int64, bool) {
	v, ok := params[name]
	if !ok {
		return 0, false
	}
	switch t := v.(type) {
	case int:
		return int64(t), true
	case int64:
		return t, true
	case int32:
		return int64(t), true
	case float64:
		return int64(t), true
	}
	return 0, false
}

func isSpace(c byte) bool {
	return c == ' ' || c == '\t' || c == '\n' || c == '\r'
}

func skipSpace(msg string, i int) int {
	for i < len(msg) && isSpace(msg[i]) {
		i++
	}
	return i
}
