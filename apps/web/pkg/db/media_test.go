package db

import (
	"context"
	"testing"
)

// PhotoURLReferenced gates the R2 cleanup that follows a replace/delete:
// the ownership check accepts any URL under the organizer's prefix, so
// two rows can legally share one object — it must survive while any row
// still serves it. Runs against the docker Postgres like the booking
// write tests (skipped without POSTGRES_URL, failed in CI).
func TestPhotoURLReferenced(t *testing.T) {
	f := newFixture(t, nil)
	ctx := context.Background()
	url := "https://media.example.com/organizers/" + f.organizerID + "/services/photo-abcd1234.png"

	referenced, err := PhotoURLReferenced(ctx, Pool(), f.organizerID, url)
	if err != nil {
		t.Fatal(err)
	}
	if referenced {
		t.Fatal("no row points at the url yet")
	}

	if _, err := Pool().Exec(ctx, `UPDATE services SET photo_url = $1 WHERE id = $2`, url, f.serviceID); err != nil {
		t.Fatal(err)
	}
	if referenced, err = PhotoURLReferenced(ctx, Pool(), f.organizerID, url); err != nil || !referenced {
		t.Fatalf("a service cover must count as a reference: referenced=%v err=%v", referenced, err)
	}

	if _, err := Pool().Exec(ctx, `UPDATE services SET photo_url = NULL WHERE id = $1`, f.serviceID); err != nil {
		t.Fatal(err)
	}
	if _, err := Pool().Exec(ctx, `UPDATE organizers SET photo_url = $1 WHERE id = $2::uuid`, url, f.organizerID); err != nil {
		t.Fatal(err)
	}
	if referenced, err = PhotoURLReferenced(ctx, Pool(), f.organizerID, url); err != nil || !referenced {
		t.Fatalf("an organizer avatar must count as a reference: referenced=%v err=%v", referenced, err)
	}

	if _, err := Pool().Exec(ctx, `UPDATE organizers SET photo_url = NULL WHERE id = $1::uuid`, f.organizerID); err != nil {
		t.Fatal(err)
	}
	if referenced, err = PhotoURLReferenced(ctx, Pool(), f.organizerID, url); err != nil || referenced {
		t.Fatalf("no row references the url — cleanup may proceed: referenced=%v err=%v", referenced, err)
	}
}
