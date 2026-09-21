package db

// Shared slice adapters for Postgres params and generated wire types.

// nullableSlice keeps nil distinct from empty for array params: nil
// becomes NULL, an empty slice becomes '{}'.
func nullableSlice(s []string) any {
	if s == nil {
		return nil
	}
	return s
}

// strSlicePtr wraps a slice for the generated *[]string fields.
func strSlicePtr(s []string) *[]string {
	if s == nil {
		return nil
	}
	return &s
}
