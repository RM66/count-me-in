package jobs

import (
	"context"
	"time"

	"countmein/internal/db"
	"countmein/internal/logx"
)

// demo.refresh — recurring refresh of the demo seed (ADR-010), the
// only producer of which is a QStash schedule (cron) created by
// apps/web/scripts/ensure-qstash.ts. Demo slot times are stored
// relative to seed time, so a demo left alone drifts into the past and
// the landing page's "See a live example" link starts showing an
// organizer with nothing bookable. SeedDemo is idempotent and replaces
// slots and bookings in place.
func HandleDemoRefresh(ctx context.Context) error {
	logx.Info("reseeding the demo organizer", nil)
	if err := db.SeedDemo(ctx, time.Now()); err != nil {
		return err
	}
	logx.Info("demo seed refreshed", nil)
	return nil
}
