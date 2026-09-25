package routes

// Helpers for the optional fields oapi-codegen renders as pointers.
// Pointer dereferencing with a default is shared: contracts.DerefOr
// (photoUrl comparisons use contracts.DerefOr(url, "") — nil means
// "no image").

// derefSlice returns the slice behind a pointer field, nil-safe.
func derefSlice(s *[]string) []string {
	if s == nil {
		return nil
	}
	return *s
}
