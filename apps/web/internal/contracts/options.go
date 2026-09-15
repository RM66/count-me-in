package contracts

import (
	"errors"
	"fmt"
)

// ValidateSelectedOptions checks a booking's selectedOptions against a
// concrete service — the semantic half of invariant 6, port of
// buildSelectedOptionsSchema: no service options → selection must be
// empty; values must exist and be unique; `single` mode allows at most
// one. Returns the normalized value (nil when nothing selected).
func ValidateSelectedOptions(serviceOptions []string, selectMode OptionsSelectMode, selected []string) ([]string, error) {
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
	if selectMode == OptionsSingle && len(selected) > 1 {
		return nil, errors.New("this service allows selecting only one option")
	}
	if len(selected) == 0 {
		return nil, nil
	}
	return selected, nil
}
