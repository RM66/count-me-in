package db

import "context"

// PhotoURLReferenced reports whether any organizer or service row still
// carries url as its photo_url. Gates the R2 cleanup that follows a
// replace/delete: the ownership check (storage.IsOwnMediaURL) validates
// only the organizer's prefix, not uniqueness, so one object can legally
// back the avatar and a cover, or two covers — deleting it while another
// row still serves it would break that row's image.
func PhotoURLReferenced(ctx context.Context, q Querier, organizerID, url string) (bool, error) {
	var referenced bool
	err := q.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM organizers WHERE id = $1::uuid AND photo_url = $2
			UNION ALL
			SELECT 1 FROM services WHERE organizer_id = $1::uuid AND photo_url = $2
		)`, organizerID, url).Scan(&referenced)
	return referenced, err
}
