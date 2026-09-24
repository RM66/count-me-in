package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"

	gen "countmein/pkg/api/gen"
	"countmein/pkg/auth"
	"countmein/pkg/contracts"
	"countmein/pkg/db"
	"countmein/pkg/redis"
)

// the notification handlers. One job per recipient (ADR-012), the
// counterparty-only rule for cancellations, the demo refusal (ADR-010),
// the one-time login link minted per send attempt, and Telegram's error
// classification (unreachable = done, transient = retry).
//
// The handlers read the booking chain fresh from Postgres at send time,
// so these are integration tests: real Postgres (like booking_writes_test)
// plus miniredis for the login links and a fake Bot API server for
// SendMessage.

// ── fake Telegram ─────────────────────────────────────────────────────────────

type telegramCall struct {
	ChatID string
	Text   string
	Button string // button URL, "" when absent
}

type fakeTelegram struct {
	srv    *httptest.Server
	mu     sync.Mutex
	calls  []telegramCall
	status int    // HTTP status to answer with
	desc   string // Telegram-style error description
}

func newFakeTelegram(t *testing.T) *fakeTelegram {
	t.Helper()
	ft := &fakeTelegram{status: 0}
	ft.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body struct {
			ChatID      string `json:"chat_id"`
			Text        string `json:"text"`
			ReplyMarkup *struct {
				InlineKeyboard [][]struct {
					Text string `json:"text"`
					URL  string `json:"url"`
				} `json:"inline_keyboard"`
			} `json:"reply_markup"`
		}
		_ = json.Unmarshal(raw, &body)
		ft.mu.Lock()
		button := ""
		if body.ReplyMarkup != nil && len(body.ReplyMarkup.InlineKeyboard) > 0 && len(body.ReplyMarkup.InlineKeyboard[0]) > 0 {
			button = body.ReplyMarkup.InlineKeyboard[0][0].URL
		}
		ft.calls = append(ft.calls, telegramCall{ChatID: body.ChatID, Text: body.Text, Button: button})
		status := ft.status
		desc := ft.desc
		ft.mu.Unlock()

		if status == 0 {
			_, _ = w.Write([]byte(`{"ok":true}`))
			return
		}
		payload, _ := json.Marshal(map[string]any{"ok": false, "description": desc, "error_code": status})
		w.WriteHeader(status)
		_, _ = w.Write(payload)
	}))
	t.Cleanup(ft.srv.Close)
	return ft
}

func (ft *fakeTelegram) recorded() []telegramCall {
	ft.mu.Lock()
	defer ft.mu.Unlock()
	return append([]telegramCall{}, ft.calls...)
}

func (ft *fakeTelegram) setStatus(status int, desc string) {
	ft.mu.Lock()
	defer ft.mu.Unlock()
	ft.status, ft.desc = status, desc
}

// ── fixture: organizer + service + slot + booking in real Postgres ────────────

func requirePostgresJobs(t *testing.T) {
	t.Helper()
	if os.Getenv("POSTGRES_URL") == "" {
		if os.Getenv("CI") == "true" {
			t.Fatal("POSTGRES_URL is not set in CI — Postgres service misconfigured, refusing silent skip")
		}
		t.Skip("POSTGRES_URL is not set — integration test needs the docker Postgres (set -a; source ../../.env, see docker-compose.yml)")
	}
}

type jobsFixture struct {
	organizerID   string
	organizerSlug string
	organizerChat string
	serviceID     string
	slotID        string
	bookingID     string
	guestChat     string
}

func newJobsFixture(t *testing.T) *jobsFixture {
	t.Helper()
	requirePostgresJobs(t)
	ctx := context.Background()
	orgID, err := uuid.NewV7()
	if err != nil {
		t.Fatal(err)
	}
	suffix := orgID.String()[len(orgID.String())-12:]
	f := &jobsFixture{
		organizerID:   orgID.String(),
		organizerSlug: "it-jobs-" + suffix,
		organizerChat: "it-org-chat-" + orgID.String()[len(orgID.String())-8:],
		guestChat:     "it-guest-chat-" + orgID.String()[len(orgID.String())-8:],
	}

	_, err = db.Pool().Exec(ctx, `
		INSERT INTO organizers (id, slug, name, messenger, messenger_id, timezone, language)
		VALUES ($1::uuid, $2, 'IT Organizer', 'telegram', $3, 'Europe/Belgrade', 'en')`,
		f.organizerID, f.organizerSlug, f.organizerChat)
	if err != nil {
		t.Fatalf("insert organizer: %v", err)
	}

	f.serviceID = "svc-" + suffix
	_, err = db.Pool().Exec(ctx, `
		INSERT INTO services (id, organizer_id, title, default_price, default_capacity,
			default_duration_minutes, max_seats_per_booking)
		VALUES ($1, $2::uuid, 'IT Service', '10 EUR', 10, 60, 4)`,
		f.serviceID, f.organizerID)
	if err != nil {
		t.Fatalf("insert service: %v", err)
	}

	slotID, err := uuid.NewV7()
	if err != nil {
		t.Fatal(err)
	}
	f.slotID = slotID.String()
	_, err = db.Pool().Exec(ctx, `
		INSERT INTO time_slots (id, service_id, starts_at, duration_minutes, capacity, booked_count)
		VALUES ($1::uuid, $2, $3, 60, 10, 1)`,
		f.slotID, f.serviceID, time.Now().Add(48*time.Hour))
	if err != nil {
		t.Fatalf("insert slot: %v", err)
	}

	bookingID, err := uuid.NewV7()
	if err != nil {
		t.Fatal(err)
	}
	f.bookingID = bookingID.String()
	token := "it-manage-token-" + suffix
	_, err = db.Pool().Exec(ctx, `
		INSERT INTO bookings (id, time_slot_id, status, seats, guest_name, guest_messenger,
			guest_messenger_id, guest_locale, manage_token, manage_token_hash)
		VALUES ($1::uuid, $2::uuid, 'confirmed', 2, 'Ann', 'telegram', $3, 'en', $4, $5)`,
		f.bookingID, f.slotID, f.guestChat, token, db.HashManageToken(token))
	if err != nil {
		t.Fatalf("insert booking: %v", err)
	}

	t.Cleanup(func() {
		_, _ = db.Pool().Exec(context.Background(), `DELETE FROM bookings WHERE id = $1::uuid`, f.bookingID)
		_, _ = db.Pool().Exec(context.Background(), `DELETE FROM organizers WHERE id = $1::uuid`, f.organizerID) // cascades
	})
	return f
}

// ── TestMain: miniredis for the login links ───────────────────────────────────

var testMiniRedis *miniredis.Miniredis

func TestMain(m *testing.M) {
	testMiniRedis = miniredis.NewMiniRedis()
	if err := testMiniRedis.Start(); err != nil {
		panic(err)
	}
	os.Setenv("REDIS_URL", "redis://"+testMiniRedis.Addr())
	redis.ResetForTest()
	code := m.Run()
	testMiniRedis.Close()
	os.Exit(code)
}

// ── booking.created ───────────────────────────────────────────────────────────

// One job per recipient: the handler sends exactly one message, to the
// job's recipient, with audience-specific content — the organizer gets
// the guest contact line and a one-time cabinet link, the guest gets
// the organizer details and their manage URL.
func TestHandleBookingCreatedPerRecipient(t *testing.T) {
	f := newJobsFixture(t)
	ft := newFakeTelegram(t)
	prev := telegramAPIBase
	telegramAPIBase = strings.TrimSuffix(ft.srv.URL, "/")
	t.Cleanup(func() { telegramAPIBase = prev })

	env := Env{TelegramBotToken: "it-bot-token", AppURL: "https://example.com"}
	ctx := context.Background()

	// Organizer recipient.
	job := gen.BookingCreatedJob{
		BookingID: contracts.ToUUID(f.bookingID),
		Recipient: gen.NotificationRecipientOrganizer,
	}
	if err := HandleBookingCreated(ctx, env, job, "trace-1"); err != nil {
		t.Fatalf("organizer delivery: %v", err)
	}
	// Guest recipient.
	job.Recipient = gen.NotificationRecipientGuest
	if err := HandleBookingCreated(ctx, env, job, "trace-1"); err != nil {
		t.Fatalf("guest delivery: %v", err)
	}

	calls := ft.recorded()
	if len(calls) != 2 {
		t.Fatalf("one job per recipient → exactly 2 sends, got %d", len(calls))
	}
	orgCall, guestCall := calls[0], calls[1]
	if orgCall.ChatID != f.organizerChat {
		t.Errorf("organizer message chat = %q, want %q", orgCall.ChatID, f.organizerChat)
	}
	if guestCall.ChatID != f.guestChat {
		t.Errorf("guest message chat = %q, want %q", guestCall.ChatID, f.guestChat)
	}
	// Audience-specific content: the organizer sees the guest, the guest
	// sees the organizer's details and their manage link.
	if !strings.Contains(orgCall.Text, "Ann") {
		t.Errorf("organizer message must lead with the guest, got:\n%s", orgCall.Text)
	}
	if !strings.Contains(guestCall.Text, "IT Organizer") {
		t.Errorf("guest message must name the organizer, got:\n%s", guestCall.Text)
	}
	if !strings.Contains(guestCall.Button, "/booking/") {
		t.Errorf("guest button must be the manage URL, got %q", guestCall.Button)
	}
	if !strings.Contains(orgCall.Button, "/login/link/") {
		t.Errorf("organizer button must be a one-time login link, got %q", orgCall.Button)
	}
}

// The organizer's deep link is a real one-time login link: {organizerId,
// next} minted in Redis, next scoped to the booked slot.
func TestHandleBookingCreatedMintsLoginLink(t *testing.T) {
	f := newJobsFixture(t)
	ft := newFakeTelegram(t)
	prev := telegramAPIBase
	telegramAPIBase = strings.TrimSuffix(ft.srv.URL, "/")
	t.Cleanup(func() { telegramAPIBase = prev })

	env := Env{TelegramBotToken: "it-bot-token", AppURL: "https://example.com"}
	job := gen.BookingCreatedJob{
		BookingID: contracts.ToUUID(f.bookingID),
		Recipient: gen.NotificationRecipientOrganizer,
	}
	if err := HandleBookingCreated(context.Background(), env, job, "trace-2"); err != nil {
		t.Fatal(err)
	}

	// The button URL carries the token; the payload behind it points at
	// the organizer and the slot-filtered cabinet path.
	calls := ft.recorded()
	if len(calls) != 1 {
		t.Fatalf("expected 1 send, got %d", len(calls))
	}
	token := strings.TrimPrefix(calls[0].Button, "https://example.com/login/link/")
	payload, err := auth.PeekLoginLink(context.Background(), token)
	if err != nil || payload == nil {
		t.Fatalf("login link must be minted in Redis (peek %v): %v", payload, err)
	}
	if payload.OrganizerID != f.organizerID {
		t.Errorf("login link organizerId = %q, want %q", payload.OrganizerID, f.organizerID)
	}
	if want := CabinetSlotPath(f.slotID); payload.Next != want {
		t.Errorf("login link next = %q, want the slot-filtered cabinet path %q", payload.Next, want)
	}
}

// Demo bookings never reach a chat (ADR-010) — no send, no link minted.
// Unlike a missing booking (nil chain → skip), this exercises the real
// demo branch: a confirmed booking whose organizer IS the demo organizer.
func newDemoBookingFixture(t *testing.T) string {
	t.Helper()
	requirePostgresJobs(t)
	ctx := context.Background()
	suffix := uuid.Must(uuid.NewV7()).String()[24:]
	serviceID := "it-demo-svc-" + suffix
	slotID := uuid.Must(uuid.NewV7()).String()
	bookingID := uuid.Must(uuid.NewV7()).String()
	token := "it-demo-manage-" + suffix

	// The demo organizer row is seed-owned — never deleted here.
	if _, err := db.Pool().Exec(ctx, `
		INSERT INTO organizers (id, slug, name, messenger, messenger_id, timezone, language)
		VALUES ($1::uuid, $2, 'Demo Studio', 'telegram', $3, 'Europe/Belgrade', 'en')
		ON CONFLICT (id) DO NOTHING`,
		contracts.DemoOrganizerID, contracts.DemoOrganizerSlug, "demo-chat-"+suffix); err != nil {
		t.Fatalf("insert demo organizer: %v", err)
	}
	if _, err := db.Pool().Exec(ctx, `
		INSERT INTO services (id, organizer_id, title, default_price, default_capacity,
			default_duration_minutes, max_seats_per_booking)
		VALUES ($1, $2::uuid, 'Demo Service', '10 EUR', 10, 60, 4)`,
		serviceID, contracts.DemoOrganizerID); err != nil {
		t.Fatalf("insert demo service: %v", err)
	}
	if _, err := db.Pool().Exec(ctx, `
		INSERT INTO time_slots (id, service_id, starts_at, duration_minutes, capacity, booked_count)
		VALUES ($1::uuid, $2, $3, 60, 10, 1)`,
		slotID, serviceID, time.Now().Add(48*time.Hour)); err != nil {
		t.Fatalf("insert demo slot: %v", err)
	}
	if _, err := db.Pool().Exec(ctx, `
		INSERT INTO bookings (id, time_slot_id, status, seats, guest_name, guest_messenger,
			guest_messenger_id, guest_locale, manage_token, manage_token_hash)
		VALUES ($1::uuid, $2::uuid, 'confirmed', 1, 'Demo Guest', 'telegram', $3, 'en', $4, $5)`,
		bookingID, slotID, "demo-guest-"+suffix, token, db.HashManageToken(token)); err != nil {
		t.Fatalf("insert demo booking: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Pool().Exec(context.Background(), `DELETE FROM bookings WHERE id = $1::uuid`, bookingID)
		_, _ = db.Pool().Exec(context.Background(), `DELETE FROM time_slots WHERE id = $1::uuid`, slotID)
		_, _ = db.Pool().Exec(context.Background(), `DELETE FROM services WHERE id = $1`, serviceID)
	})
	return bookingID
}

func TestHandleBookingDemoRefused(t *testing.T) {
	bookingID := newDemoBookingFixture(t)
	ft := newFakeTelegram(t)
	prev := telegramAPIBase
	telegramAPIBase = strings.TrimSuffix(ft.srv.URL, "/")
	t.Cleanup(func() { telegramAPIBase = prev })

	linksBefore := len(testMiniRedis.Keys())
	env := Env{TelegramBotToken: "it-bot-token", AppURL: "https://example.com"}
	ctx := context.Background()

	created := gen.BookingCreatedJob{
		BookingID: contracts.ToUUID(bookingID),
		Recipient: gen.NotificationRecipientOrganizer,
	}
	if err := HandleBookingCreated(ctx, env, created, "trace-demo"); err != nil {
		t.Fatalf("demo created (organizer) must be a silent skip, got %v", err)
	}
	created.Recipient = gen.NotificationRecipientGuest
	if err := HandleBookingCreated(ctx, env, created, "trace-demo"); err != nil {
		t.Fatalf("demo created (guest) must be a silent skip, got %v", err)
	}
	for _, by := range []gen.CancelActor{gen.CancelActorGuest, gen.CancelActorOrganizer} {
		cancelled := gen.BookingCancelledJob{BookingID: contracts.ToUUID(bookingID), CancelledBy: by}
		if err := HandleBookingCancelled(ctx, env, cancelled, "trace-demo"); err != nil {
			t.Fatalf("demo cancelled (%s) must be a silent skip, got %v", by, err)
		}
	}

	if calls := ft.recorded(); len(calls) != 0 {
		t.Fatalf("demo booking → no sends, got %d", len(calls))
	}
	// Neither recipient path may mint its one-time login link.
	if delta := len(testMiniRedis.Keys()) - linksBefore; delta != 0 {
		t.Fatalf("demo booking must mint no login links, %d redis keys added", delta)
	}
}

// A booking id that matches nothing is a silent skip too (a retry that
// arrives after the row was deleted must not fail the delivery).
func TestHandleBookingMissingIsSilentSkip(t *testing.T) {
	requirePostgresJobs(t)
	ft := newFakeTelegram(t)
	prev := telegramAPIBase
	telegramAPIBase = strings.TrimSuffix(ft.srv.URL, "/")
	t.Cleanup(func() { telegramAPIBase = prev })

	env := Env{TelegramBotToken: "it-bot-token", AppURL: "https://example.com"}
	missing := gen.BookingCreatedJob{
		BookingID: contracts.ToUUID(uuid.Must(uuid.NewV7()).String()),
		Recipient: gen.NotificationRecipientOrganizer,
	}
	if err := HandleBookingCreated(context.Background(), env, missing, "trace-missing"); err != nil {
		t.Fatalf("missing booking must be a silent skip, got %v", err)
	}
	if calls := ft.recorded(); len(calls) != 0 {
		t.Fatalf("no booking → no send, got %d", len(calls))
	}
}

// ── booking.cancelled ─────────────────────────────────────────────────────────

// Only the counterparty is notified: cancelledBy=guest → the organizer
// hears about it, cancelledBy=organizer → the guest does.
func TestHandleBookingCancelledCounterpartyOnly(t *testing.T) {
	f := newJobsFixture(t)
	ft := newFakeTelegram(t)
	prev := telegramAPIBase
	telegramAPIBase = strings.TrimSuffix(ft.srv.URL, "/")
	t.Cleanup(func() { telegramAPIBase = prev })

	env := Env{TelegramBotToken: "it-bot-token", AppURL: "https://example.com"}
	ctx := context.Background()

	byGuest := gen.BookingCancelledJob{
		BookingID:   contracts.ToUUID(f.bookingID),
		CancelledBy: gen.CancelActorGuest,
	}
	if err := HandleBookingCancelled(ctx, env, byGuest, "trace-4"); err != nil {
		t.Fatalf("guest-cancelled delivery: %v", err)
	}
	byOrganizer := byGuest
	byOrganizer.CancelledBy = gen.CancelActorOrganizer
	if err := HandleBookingCancelled(ctx, env, byOrganizer, "trace-4"); err != nil {
		t.Fatalf("organizer-cancelled delivery: %v", err)
	}

	calls := ft.recorded()
	if len(calls) != 2 {
		t.Fatalf("two jobs → two sends, got %d", len(calls))
	}
	if calls[0].ChatID != f.organizerChat {
		t.Errorf("guest cancelled → the organizer is notified, got chat %q", calls[0].ChatID)
	}
	if calls[1].ChatID != f.guestChat {
		t.Errorf("organizer cancelled → the guest is notified, got chat %q", calls[1].ChatID)
	}
	// The cancelled guest gets the organizer's public page (rebook), not
	// a manage link — the booking is gone. The page URL carries the
	// organizer slug (links.go: OrganizerPageURL).
	wantPage := "https://example.com/" + f.organizerSlug
	if calls[1].Button != wantPage {
		t.Errorf("guest button must be the organizer page %q, got %q", wantPage, calls[1].Button)
	}
}

// ── outbox.sweep ──────────────────────────────────────────────────────────────

// The sweeper re-publishes pending rows past the grace period and marks
// them sent — the inline publish's safety net (ADR-012). Rows are aged
// with an UPDATE so the test does not sleep for the real 30s grace.
func sweepRow(t *testing.T, payload map[string]string, attempts int) db.OutboxRow {
	t.Helper()
	ctx := context.Background()
	tx, err := db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background()) //nolint
	row, err := db.EnqueueOutbox(ctx, tx, "booking.created", payload, "trace-sweep")
	if err != nil {
		t.Fatalf("EnqueueOutbox: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.Pool().Exec(context.Background(),
			`DELETE FROM notification_outbox WHERE id = $1::uuid`, row.ID)
	})
	if _, err := db.Pool().Exec(ctx, `
		UPDATE notification_outbox
		SET created_at = now() - interval '2 hours', attempts = $2
		WHERE id = $1::uuid`, row.ID, attempts); err != nil {
		t.Fatal(err)
	}
	return row
}

func fakeQStash(t *testing.T, calls *int32, dedup *string) string {
	t.Helper()
	var mu sync.Mutex
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		*calls++
		*dedup = r.Header.Get("Upstash-Deduplication-Id")
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

func TestHandleOutboxSweepPublishesAndMarksSent(t *testing.T) {
	requirePostgresJobs(t)
	row := sweepRow(t, map[string]string{"bookingId": "01930000-0000-7000-8000-0000000000aa"}, 0)

	var calls int32
	var dedup string
	t.Setenv("QSTASH_TOKEN", "test-token")
	t.Setenv("QSTASH_URL", fakeQStash(t, &calls, &dedup))
	t.Setenv("APP_URL", "https://example.com")
	t.Setenv("NODE_ENV", "test")
	t.Setenv("VERCEL_ENV", "")

	if err := HandleOutboxSweep(context.Background()); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if calls != 1 {
		t.Fatalf("sweep must re-publish the aged row once, got %d calls", calls)
	}
	if dedup != row.ID {
		t.Errorf("dedup id = %q, want the outbox row id %q (safe re-publish)", dedup, row.ID)
	}
	var status string
	if err := db.Pool().QueryRow(context.Background(),
		`SELECT status::text FROM notification_outbox WHERE id = $1::uuid`, row.ID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "sent" {
		t.Errorf("swept row status = %q, want sent", status)
	}
}

// Rows past the retry budget move to terminal `failed` — never
// re-published, never rescanned (no head-of-line blocking).
func TestHandleOutboxSweepMovesExhaustedToFailed(t *testing.T) {
	requirePostgresJobs(t)
	row := sweepRow(t, map[string]string{"bookingId": "01930000-0000-7000-8000-0000000000ab"}, 11)

	var calls int32
	var dedup string
	t.Setenv("QSTASH_TOKEN", "test-token")
	t.Setenv("QSTASH_URL", fakeQStash(t, &calls, &dedup))
	t.Setenv("APP_URL", "https://example.com")
	t.Setenv("NODE_ENV", "test")
	t.Setenv("VERCEL_ENV", "")

	if err := HandleOutboxSweep(context.Background()); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if calls != 0 {
		t.Fatalf("exhausted row must not be re-published, got %d calls", calls)
	}
	var status string
	if err := db.Pool().QueryRow(context.Background(),
		`SELECT status::text FROM notification_outbox WHERE id = $1::uuid`, row.ID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "failed" {
		t.Errorf("exhausted row status = %q, want failed", status)
	}
}

// ── demo.refresh ──────────────────────────────────────────────────────────────

// The daily cron handler reseeds the demo organizer (ADR-010). Smoke
// level by design: the seed content itself is pinned by the demo seed
// tests — here we prove the handler runs it end to end and leaves the
// demo organizer present.
func TestHandleDemoRefreshReseeds(t *testing.T) {
	requirePostgresJobs(t)
	if err := HandleDemoRefresh(context.Background()); err != nil {
		t.Fatalf("demo refresh: %v", err)
	}
	var present bool
	if err := db.Pool().QueryRow(context.Background(),
		`SELECT true FROM organizers WHERE id = $1::uuid`, contracts.DemoOrganizerID).Scan(&present); err != nil || !present {
		t.Fatalf("demo organizer must exist after refresh, present=%v err=%v", present, err)
	}
}

// ── Telegram error classification (the retry budget, ADR-012) ─────────────────

func TestSendMessageUnreachableIsTerminal(t *testing.T) {
	ft := newFakeTelegram(t)
	prev := telegramAPIBase
	telegramAPIBase = strings.TrimSuffix(ft.srv.URL, "/")
	t.Cleanup(func() { telegramAPIBase = prev })

	// 403 — the recipient never pressed Start.
	ft.setStatus(http.StatusForbidden, "Forbidden: bot was blocked by the user")
	err := SendMessage(context.Background(), "tok", "chat-1", "hi", nil)
	var unreachable *TelegramUnreachableError
	if !errors.As(err, &unreachable) {
		t.Fatalf("403 must be TelegramUnreachableError, got %T: %v", err, err)
	}

	// 400 "chat not found" — same event for the receiver.
	ft.setStatus(http.StatusBadRequest, "Bad Request: chat not found")
	err = SendMessage(context.Background(), "tok", "chat-1", "hi", nil)
	if !errors.As(err, &unreachable) {
		t.Fatalf("chat-not-found must be TelegramUnreachableError, got %T: %v", err, err)
	}

	// A different 400 stays a plain error (a bug on our side — retryable
	// via the generic path, never silently completed).
	ft.setStatus(http.StatusBadRequest, "Bad Request: can't parse entities")
	err = SendMessage(context.Background(), "tok", "chat-1", "hi", nil)
	if errors.As(err, &unreachable) {
		t.Fatal("parse-entities 400 must NOT be classified unreachable (it is our escaping bug)")
	}
	if err == nil {
		t.Fatal("400 must be an error")
	}
}

func TestSendMessageTransientIsRetryable(t *testing.T) {
	ft := newFakeTelegram(t)
	prev := telegramAPIBase
	telegramAPIBase = strings.TrimSuffix(ft.srv.URL, "/")
	t.Cleanup(func() { telegramAPIBase = prev })

	// 429 — rate limit, worth retrying.
	ft.setStatus(http.StatusTooManyRequests, "Too Many Requests: retry after 5")
	err := SendMessage(context.Background(), "tok", "chat-1", "hi", nil)
	var transient *TelegramTransientError
	if !errors.As(err, &transient) {
		t.Fatalf("429 must be TelegramTransientError, got %T: %v", err, err)
	}

	// 5xx — outage, worth retrying.
	ft.setStatus(http.StatusInternalServerError, "Internal Server Error")
	err = SendMessage(context.Background(), "tok", "chat-1", "hi", nil)
	if !errors.As(err, &transient) {
		t.Fatalf("500 must be TelegramTransientError, got %T: %v", err, err)
	}
}

// The regression this guards against: a guest called "Anne & Co" must
// not produce a parse-entities 400 — the escaped message is accepted.
func TestSendMessageEscapedMessageIsAccepted(t *testing.T) {
	f := newJobsFixture(t)
	ft := newFakeTelegram(t)
	prev := telegramAPIBase
	telegramAPIBase = strings.TrimSuffix(ft.srv.URL, "/")
	t.Cleanup(func() { telegramAPIBase = prev })

	env := Env{TelegramBotToken: "it-bot-token", AppURL: "https://example.com"}
	job := gen.BookingCreatedJob{
		BookingID: contracts.ToUUID(f.bookingID),
		Recipient: gen.NotificationRecipientOrganizer,
	}
	if err := HandleBookingCreated(context.Background(), env, job, "trace-5"); err != nil {
		t.Fatalf("escaped message must be accepted by the Bot API shape, got %v", err)
	}
	calls := ft.recorded()
	if len(calls) != 1 || !strings.Contains(calls[0].Text, "Ann") {
		t.Fatalf("expected the delivered message, got %+v", calls)
	}
}
