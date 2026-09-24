// Package queue publishes jobs to Upstash QStash after the booking
// transaction commits (ADR-012). Publishing is an HTTPS call, so it
// cannot join the Postgres transaction; the contract is
// publish-after-commit, QStash owns delivery from there (at-least-once,
// 5 retries with exponential backoff).
//
// Every publish goes through the transactional outbox row written in
// the booking transaction: the row id is
// sent as Upstash-Deduplication-Id, so a race between the inline
// publish and the sweeper — or a QStash retry — cannot deliver the same
// notification twice. The caller marks the row `sent` after a
// successful POST.
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

// PublishOutbox publishes one outbox row's payload to its queue and
// returns the outcome. dedupID (the outbox row id) is sent as
// Upstash-Deduplication-Id — QStash suppresses a redelivery of the same
// id, which makes the sweeper's at-least-once re-publish safe against
// the inline path and against its own retries. traceID travels
// as Upstash-Trace-Id so the job handler can correlate the pipeline.
//
// In dev without QSTASH_TOKEN the publish is skipped with nil — local
// deliveries would be unreachable anyway (QStash POSTs to APP_URL;
// localhost is not routable from Upstash), and the caller marks the row
// `sent` so the sweeper does not churn on it.
func PublishOutbox(ctx context.Context, queueName string, payload json.RawMessage, dedupID, traceID string) error {
	token := os.Getenv("QSTASH_TOKEN")
	if token == "" {
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
	destination, err := destination(queueName)
	if err != nil {
		return err
	}
	return publishBody(ctx, token, base, destination, queueName, payload, dedupID, traceID)
}

// publishBody is the shared HTTP POST to QStash's publish endpoint.
// dedupID (outbox row id) and traceID are forwarded as QStash headers —
// QStash forwards Upstash-* headers to the destination, so the job
// handler reads the trace id from the incoming request headers.
func publishBody(ctx context.Context, token, base, destination, queueName string, body []byte, dedupID, traceID string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		base+"/v2/publish/"+destination, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Upstash-Retries", fmt.Sprintf("%d", jobRetries))
	if dedupID != "" {
		// Suppresses duplicate deliveries of the same outbox row —
		// the sweeper re-publish and QStash retries become no-ops
		// instead of duplicate Telegram messages.
		req.Header.Set("Upstash-Deduplication-Id", dedupID)
	}
	if traceID != "" {
		req.Header.Set("Upstash-Trace-Id", traceID)
	}

	res, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, res.Body)
	if res.StatusCode >= 300 {
		return fmt.Errorf("qstash publish %s: HTTP %d", queueName, res.StatusCode)
	}
	return nil
}

// destination — the QStash destination for a queue: this deployment's
// receiver route ({APP_URL}/api/jobs/{queue}).
func destination(queueName string) (string, error) {
	appURL := strings.TrimRight(os.Getenv("APP_URL"), "/")
	if appURL == "" {
		return "", fmt.Errorf("APP_URL is not set")
	}
	return appURL + "/api/jobs/" + queueName, nil
}

func isProduction() bool {
	return os.Getenv("NODE_ENV") == "production" || os.Getenv("VERCEL_ENV") == "production"
}
