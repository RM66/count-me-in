package contracts

import "testing"

func TestValidateSelectedOptionsNoServiceOptions(t *testing.T) {
	if got, err := ValidateSelectedOptions(nil, OptionsSingle, nil); err != nil || got != nil {
		t.Fatalf("no options, no selection → nil, nil; got %v, %v", got, err)
	}
	if _, err := ValidateSelectedOptions(nil, OptionsSingle, []string{"Any"}); err == nil {
		t.Fatal("selection against a service without options must fail")
	}
}

func TestValidateSelectedOptionsMembershipAndDuplicates(t *testing.T) {
	service := []string{"Downtown studio", "Riverside studio"}
	if _, err := ValidateSelectedOptions(service, OptionsSingle, []string{"Nowhere"}); err == nil {
		t.Fatal("unknown option must fail")
	}
	if _, err := ValidateSelectedOptions(service, OptionsMulti, []string{"Downtown studio", "Downtown studio"}); err == nil {
		t.Fatal("duplicates must fail")
	}
}

func TestValidateSelectedOptionsSingleMode(t *testing.T) {
	service := []string{"A", "B"}
	if _, err := ValidateSelectedOptions(service, OptionsSingle, []string{"A", "B"}); err == nil {
		t.Fatal("single mode allows at most one")
	}
	got, err := ValidateSelectedOptions(service, OptionsSingle, []string{"B"})
	if err != nil || len(got) != 1 || got[0] != "B" {
		t.Fatalf("single selection: %v, %v", got, err)
	}
}

func TestValidateSelectedOptionsEmptyNormalizesToNil(t *testing.T) {
	service := []string{"A"}
	if got, err := ValidateSelectedOptions(service, OptionsMulti, nil); err != nil || got != nil {
		t.Fatalf("empty selection normalizes to nil; got %v, %v", got, err)
	}
	if got, err := ValidateSelectedOptions(service, OptionsMulti, []string{}); err != nil || got != nil {
		t.Fatalf("explicit empty normalizes to nil; got %v, %v", got, err)
	}
}
