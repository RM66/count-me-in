// Package queue publishes jobs to Upstash QStash after the booking
// transaction commits (ADR-012). Publishing is an HTTPS call, so it
// cannot join the Postgres transaction; the contract is
// publish-after-commit, QStash owns delivery from there (at-least-once,
// 5 retries with exponential backoff).
//
// Fire-and-forget: errors are logged, never returned — a notification
// must not fail a request whose booking already committed. The
// accepted loss window is a crash between commit and publish.
package queue

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"countmein/pkg/contracts"
	"countmein/pkg/logx"
)

// How hard QStash tries before dropping a message: 5 delivery attempts
// with exponential backoff. Permanent failures (recipient never
// pressed Start) are completed by the receiver with a 200, so they
// never spend this budget.
const jobRetries = 5

const defaultQStashURL = "https://qstash.upstash.io"

var (
	warnedAboutMissingToken sync.Once
	httpClient              = &http.Client{Timeout: 10 * time.Second}
)

// PublishBookingCreated publishes the two booking.created
// notifications for a fresh booking. One job per recipient — see the
// fan-out note in contracts/jobs — so a retry re-sends only to the
// party that failed.
//
// Call after the booking transaction commits, not inside it. There is
// no after()-hook on the Vercel Go runtime (no post-response
// execution), so this runs inline before the response is written —
// same publish-after-commit contract, the guest just waits out the
// round trip.
//
// The two publishes run concurrently: they are independent HTTPS calls
// and serializing them would add the second round trip's latency to the
// guest's response for no benefit. Each publish absorbs its own errors.
func PublishBookingCreated(ctx context.Context, bookingID string) {
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		publish(ctx, contracts.QueueBookingCreated, contracts.BookingCreatedJob{
			BookingID: bookingID,
			Recipient: contracts.RecipientOrganizer,
		})
	}()
	go func() {
		defer wg.Done()
		publish(ctx, contracts.QueueBookingCreated, contracts.BookingCreatedJob{
			BookingID: bookingID,
			Recipient: contracts.RecipientGuest,
		})
	}()
	wg.Wait()
}

// PublishBookingCancelled publishes the booking.cancelled job for a
// cancelled booking. Only the actor is recorded; the receiver notifies
// the counterparty.
func PublishBookingCancelled(ctx context.Context, bookingID string, cancelledBy contracts.CancelActor) {
	publish(ctx, contracts.QueueBookingCancelled, contracts.BookingCancelledJob{
		BookingID:   bookingID,
		CancelledBy: cancelledBy,
	})
}

func publish(ctx context.Context, queue string, job any) {
	err := func() error {
		token := os.Getenv("QSTASH_TOKEN")
		if token == "" {
			// Dev without a token: skip with a one-time warning — local
			// deliveries would be unreachable anyway (QStash POSTs to
			// APP_URL; localhost is not routable from Upstash).
			if isProduction() {
				return fmt.Errorf("QSTASH_TOKEN is not set")
			}
			warnedAboutMissingToken.Do(func() {
				logx.Info("QSTASH_TOKEN is not set — skipping notification publish (dev only)", nil)
			})
			return nil
		}

		base := strings.TrimRight(os.Getenv("QSTASH_URL"), "/")
		if base == "" {
			base = defaultQStashURL
		}
		destination, err := destination(queue)
		if err != nil {
			return err
		}

		body, err := json.Marshal(job)
		if err != nil {
			return err
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost,
			base+"/v2/publish/"+destination, bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Upstash-Retries", fmt.Sprintf("%d", jobRetries))

		res, err := httpClient.Do(req)
		if err != nil {
			return err
		}
		defer res.Body.Close()
		_, _ = io.Copy(io.Discard, res.Body)
		if res.StatusCode >= 300 {
			return fmt.Errorf("qstash publish %s: HTTP %d", queue, res.StatusCode)
		}
		return nil
	}()
	if err != nil {
		// Absorbed: committed bookings must not fail over a
		// notification (Sentry in the TS version; structured log here).
		logx.Error(err, map[string]any{"queue": queue, "source": "qstash-publish"})
	}
}

// destination — the QStash destination for a queue: this deployment's
// receiver route ({APP_URL}/api/jobs/{queue}).
func destination(queue string) (string, error) {
	appURL := strings.TrimRight(os.Getenv("APP_URL"), "/")
	if appURL == "" {
		return "", fmt.Errorf("APP_URL is not set")
	}
	return appURL + "/api/jobs/" + queue, nil
}

func isProduction() bool {
	return os.Getenv("NODE_ENV") == "production" || os.Getenv("VERCEL_ENV") == "production"
}
