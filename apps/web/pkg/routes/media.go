package routes

import (
	"context"
	"time"

	"countmein/pkg/db"
	"countmein/pkg/logx"
	"countmein/pkg/storage"
)

// mediaCleanupTimeout caps the post-response R2 work — it runs inline
// after the commit, so it must not hold the function open (maxDuration
// is 10s in vercel.json).
const mediaCleanupTimeout = 3 * time.Second

// cleanupReplacedMedia removes the object behind oldURL after its row
// committed a new value (or was deleted). Best-effort, like the
// notification publisher (ADR-012): a storage failure must not fail an
// already-committed request, so failures are logged and swallowed. The
// work gets its own detached timeout context (not r.Context()) — the
// response is already written, and a client disconnect must not orphan
// the old object.
//
// The reference check exists because IsOwnMediaURL validates only the
// organizer's prefix, not uniqueness: one object can back the avatar and
// a cover, or two covers, so the delete is skipped while any row still
// points at oldURL.
func cleanupReplacedMedia(organizerID, oldURL, newURL string) {
	if oldURL == "" || oldURL == newURL {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), mediaCleanupTimeout)
	defer cancel()

	referenced, err := db.PhotoURLReferenced(ctx, db.Pool(), organizerID, oldURL)
	if err != nil {
		logx.Error(err, map[string]any{
			"organizerId": organizerID,
			"op":          "media-reference-check",
		})
		return
	}
	if referenced {
		logx.Info("skipped media cleanup", map[string]any{
			"organizerId": organizerID,
			"reason":      "still-referenced",
		})
		return
	}
	storage.DeleteReplacedMedia(ctx, organizerID, oldURL, newURL)
}
