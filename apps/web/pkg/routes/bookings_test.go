package routes

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"countmein/pkg/auth"
	"countmein/pkg/authtest"
	"countmein/pkg/contracts"
	"countmein/pkg/db"

	gen "countmein/pkg/api/gen"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
)

// the booking routes' request-level contracts — rate limits, body
// validation, the ticket door, the demo/anonymous refusal, and the
// after-commit publish absorbing its own errors. The DB-dependent paths
// (sold-out mapping, 201 happy path) are pinned by the integration test
// in pkg/db/booking_writes_test.go against a real Postgres; mocks would
// hide exactly the class of bugs that test exists for.

var testRedis *miniredis.Miniredis

func TestMain(m *testing.M) {
	mr, err := miniredis.Run()
	if err != nil {
		panic("miniredis: " + err.Error())
	}
	testRedis = mr
	defer testRedis.Close()
	os.Setenv("REDIS_URL", "redis://"+testRedis.Addr())
	os.Setenv("AUTH_SECRET", "routes-test-golden-secret")
	os.Exit(m.Run())
}

// mintTestToken is the shared organizer-auth mint (single copy in
// pkg/authtest; the derivation itself is pinned by
// TestDerivedSigningKeyGolden in pkg/auth).
func mintTestToken(secret, sub, slug string, exp int64) string {
	return authtest.MintOrganizerToken(secret, sub, slug, exp)
}

func decodeBodyError(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("body must be a JSON object, got %q", w.Body.String())
	}
	return body
}

// A schema-valid booking body: everything the spec requires, with the
// ticket swapped per test.
const validBookingBody = `{"serviceId":"svc-abcdefghij123456","timeSlotId":"01930000-0000-7000-8000-000000000001","seats":1,"guestName":"Ann","guestTicket":"%s"}`

// ── BookingCreate ────────────────────────────────────────────────────────────

func TestBookingCreateRateLimit(t *testing.T) {
	// 5/min per IP. The first five requests burn the bucket (each fails
	// body validation — 400, but AFTER the limiter), the sixth is a 429.
	for i := 0; i < 5; i++ {
		r := httptest.NewRequest(http.MethodPost, "/api/bookings", nil)
		r.Header.Set("X-Forwarded-For", "198.51.100.1")
		w := httptest.NewRecorder()
		BookingCreate(w, r)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("request %d: expected 400 (empty body), got %d", i+1, w.Code)
		}
	}
	r := httptest.NewRequest(http.MethodPost, "/api/bookings", nil)
	r.Header.Set("X-Forwarded-For", "198.51.100.1")
	w := httptest.NewRecorder()
	BookingCreate(w, r)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("6th request must be a 429, got %d", w.Code)
	}
	if w.Header().Get("Retry-After") == "" {
		t.Error("429 must carry Retry-After")
	}
}

func TestBookingCreateInvalidBody(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/api/bookings", strings.NewReader(`{"guestName":`))
	r.Header.Set("X-Forwarded-For", "198.51.100.2")
	w := httptest.NewRecorder()
	BookingCreate(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("broken JSON must be a 400, got %d", w.Code)
	}
	body := decodeBodyError(t, w)
	if body["error"] == "" {
		t.Error("400 must carry localized error copy")
	}
}

func TestBookingCreateUnknownTicket(t *testing.T) {
	// Schema-valid body, unknown ticket: the guest identity door refuses
	// before any DB access — a replayed or forged ticket must never
	// reach the booking transaction.
	r := httptest.NewRequest(http.MethodPost, "/api/bookings",
		strings.NewReader(strings.Replace(validBookingBody, "%s", "unknown-ticket-aaaaaaaaaaaaaaaaaaaaaaaaa", 1)))
	r.Header.Set("X-Forwarded-For", "198.51.100.3")
	w := httptest.NewRecorder()
	BookingCreate(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("unknown ticket must be a 401, got %d (%s)", w.Code, w.Body.String())
	}
}

func TestBookingCreateRawMessengerIdIgnored(t *testing.T) {
	// Invariant 8: identity comes only from the ticket. A body claiming
	// a messengerId must not authenticate the request — the unknown
	// ticket still refuses it with a 401.
	body := strings.Replace(validBookingBody, "%s", "unknown-ticket-bbbbbbbbbbbbbbbbbbbbbbbbb", 1)
	body = strings.TrimSuffix(body, "}") + `,"messengerId":"999999"}`
	r := httptest.NewRequest(http.MethodPost, "/api/bookings", strings.NewReader(body))
	r.Header.Set("X-Forwarded-For", "198.51.100.4")
	w := httptest.NewRecorder()
	BookingCreate(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("a client-supplied messengerId must not authenticate, got %d", w.Code)
	}
}

// ── BookingLookup ────────────────────────────────────────────────────────────

func TestBookingLookupInvalidBody(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/api/bookings/lookup", strings.NewReader(`{`))
	r.Header.Set("X-Forwarded-For", "198.51.100.5")
	w := httptest.NewRecorder()
	BookingLookup(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("broken JSON must be a 400, got %d", w.Code)
	}
}

func TestBookingLookupUnknownTicket(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/api/bookings/lookup",
		strings.NewReader(`{"guestTicket":"unknown-ticket-ccccccccccccccccccccccc"}`))
	r.Header.Set("X-Forwarded-For", "198.51.100.6")
	w := httptest.NewRecorder()
	BookingLookup(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("unknown ticket must be a 401, got %d", w.Code)
	}
}

// ── BookingCancel ────────────────────────────────────────────────────────────

func TestBookingCancelRateLimit(t *testing.T) {
	// 10/min per IP — the manageToken is a brute-forceable credential,
	// so cancel is throttled like booking creation.
	for i := 0; i < 10; i++ {
		r := httptest.NewRequest(http.MethodPost, "/api/bookings/cancel", nil)
		r.Header.Set("X-Forwarded-For", "198.51.100.7")
		w := httptest.NewRecorder()
		BookingCancel(w, r)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("request %d: expected 400 (empty body), got %d", i+1, w.Code)
		}
	}
	r := httptest.NewRequest(http.MethodPost, "/api/bookings/cancel", nil)
	r.Header.Set("X-Forwarded-For", "198.51.100.7")
	w := httptest.NewRecorder()
	BookingCancel(w, r)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("11th request must be a 429, got %d", w.Code)
	}
}

func TestBookingCancelInvalidBody(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/api/bookings/cancel", strings.NewReader(`{"manageToken":`))
	r.Header.Set("X-Forwarded-For", "198.51.100.8")
	w := httptest.NewRecorder()
	BookingCancel(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("broken JSON must be a 400, got %d", w.Code)
	}
}

// ── BookingCancelByOrganizer ─────────────────────────────────────────────────

func organizerRequest(path, body, organizerID string) (*http.Request, *httptest.ResponseRecorder) {
	r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	if organizerID != "" {
		token := mintTestToken("routes-test-golden-secret", organizerID, "studio", time.Now().Add(time.Minute).Unix())
		r.Header.Set(auth.OrganizerAuthHeader, token)
	}
	return r, httptest.NewRecorder()
}

func TestBookingCancelByOrganizerAnonymous(t *testing.T) {
	// /cabinet needs no session (ADR-010) — an anonymous visitor is a
	// demo-cabinet visitor and must not cancel anyone's booking.
	r, w := organizerRequest("/api/bookings/cancel-by-organizer", `{"bookingId":"01930000-0000-7000-8000-000000000001"}`, "")
	BookingCancelByOrganizer(w, r)
	if w.Code != http.StatusForbidden {
		t.Fatalf("anonymous cancel-by-organizer must be a 403, got %d", w.Code)
	}
	if body := decodeBodyError(t, w); body["code"] != contracts.DemoReadOnlyCode {
		t.Errorf("403 must carry the demo code, got %v", body["code"])
	}
}

func TestBookingCancelByOrganizerDemoSession(t *testing.T) {
	r, w := organizerRequest("/api/bookings/cancel-by-organizer",
		`{"bookingId":"01930000-0000-7000-8000-000000000001"}`, contracts.DemoOrganizerID)
	BookingCancelByOrganizer(w, r)
	if w.Code != http.StatusForbidden {
		t.Fatalf("demo session must be a 403, got %d", w.Code)
	}
}

func TestBookingCancelByOrganizerInvalidBody(t *testing.T) {
	// A signed-in organizer passes the guard, then fails body validation
	// — proving the guard and the decode are separate doors.
	r, w := organizerRequest("/api/bookings/cancel-by-organizer", `{"bookingId":`, "01930000-0000-7000-8000-0000000000c1")
	BookingCancelByOrganizer(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("broken JSON must be a 400, got %d", w.Code)
	}
}

// ── publishOutboxRows ─────────────────────────────────────────────────────────

// The publisher absorbs its own errors (ADR-012): the booking is already
// committed, so a failing publish must not fail anything — the row
// stays `pending` and the sweeper retries it.
func TestPublishOutboxRowsAbsorbsPublishErrors(t *testing.T) {
	t.Setenv("QSTASH_TOKEN", "test-token")
	t.Setenv("QSTASH_URL", "http://127.0.0.1:1") // unreachable — fails fast
	t.Setenv("APP_URL", "https://example.com")
	t.Setenv("NODE_ENV", "test")

	rows := []db.OutboxRow{
		{ID: "01930000-0000-7000-8000-0000000000d1", Queue: "booking.created", Payload: `{"bookingId":"x","recipient":"organizer"}`},
		{ID: "01930000-0000-7000-8000-0000000000d2", Queue: "booking.created", Payload: `{"bookingId":"x","recipient":"guest"}`},
	}
	// Must not panic and must not propagate the publish error.
	publishOutboxRows(context.Background(), rows, "trace-absorb")
}

// ── Booking routes against a real Postgres ───────────────────────────────────
// The pre-DB doors above prove the request never reaches the transaction
// on bad input; these prove the full wire once it does: 201 + fan-out +
// pending outbox on success (the publish target is unreachable, so rows
// must stay pending for the sweeper), and the domain→HTTP mapping
// (sold-out → 409 with seatsLeft, unknown manageToken → 404).

func requirePostgres(t *testing.T) {
	t.Helper()
	if os.Getenv("POSTGRES_URL") == "" {
		// Same rule as pkg/db: a silent skip in CI would leave the
		// route↔mapper wiring unverified while the pipeline stays green.
		if os.Getenv("CI") == "true" {
			t.Fatal("POSTGRES_URL is not set in CI — Postgres service misconfigured, refusing silent skip")
		}
		t.Skip("POSTGRES_URL is not set — integration test needs the docker Postgres (set -a; source ../../.env, see docker-compose.yml)")
	}
}

type routeFixture struct {
	organizerID string
	serviceID   string
	slotID      string
	bookingIDs  []string
}

func newRouteFixture(t *testing.T, capacity, booked int) *routeFixture {
	t.Helper()
	requirePostgres(t)
	ctx := context.Background()
	orgID := uuid.Must(uuid.NewV7()).String()
	var rnd [8]byte
	if _, err := rand.Read(rnd[:]); err != nil {
		t.Fatal(err)
	}
	f := &routeFixture{
		organizerID: orgID,
		serviceID:   "rtest-" + hex.EncodeToString(rnd[:]),
		slotID:      uuid.Must(uuid.NewV7()).String(),
	}
	suffix := orgID[len(orgID)-12:]
	if _, err := db.Pool().Exec(ctx, `
		INSERT INTO organizers (id, slug, name, messenger, messenger_id, timezone, language)
		VALUES ($1::uuid, $2, $3, 'telegram', $4, 'Europe/Belgrade', 'en')`,
		f.organizerID, "rt-org-"+suffix, "Route Test Organizer", "rt-"+suffix); err != nil {
		t.Fatalf("insert organizer: %v", err)
	}
	if _, err := db.Pool().Exec(ctx, `
		INSERT INTO services (id, organizer_id, title, default_price, default_capacity,
			default_duration_minutes, max_seats_per_booking)
		VALUES ($1, $2::uuid, 'Route Test Service', '10 EUR', 10, 60, 4)`,
		f.serviceID, f.organizerID); err != nil {
		t.Fatalf("insert service: %v", err)
	}
	if _, err := db.Pool().Exec(ctx, `
		INSERT INTO time_slots (id, service_id, starts_at, duration_minutes, capacity, booked_count)
		VALUES ($1::uuid, $2, $3, 60, $4, $5)`,
		f.slotID, f.serviceID, time.Now().Add(48*time.Hour), capacity, booked); err != nil {
		t.Fatalf("insert slot: %v", err)
	}
	t.Cleanup(func() {
		if len(f.bookingIDs) > 0 {
			_, _ = db.Pool().Exec(context.Background(),
				`DELETE FROM notification_outbox WHERE (payload::jsonb->>'bookingId')::text = ANY($1)`, f.bookingIDs)
			_, _ = db.Pool().Exec(context.Background(),
				`DELETE FROM bookings WHERE id::text = ANY($1)`, f.bookingIDs)
		}
		_, _ = db.Pool().Exec(context.Background(),
			`DELETE FROM organizers WHERE id = $1::uuid`, f.organizerID) // cascades services + slots
	})
	return f
}

func guestTicket(t *testing.T, messengerID string) string {
	t.Helper()
	ticket, err := auth.IssueTicket(context.Background(), contracts.AuthTicketPayload{
		Messenger:   "telegram",
		MessengerID: messengerID,
		DisplayName: "Ann",
		Purpose:     auth.TicketPurposeGuest,
	})
	if err != nil {
		t.Fatalf("IssueTicket: %v", err)
	}
	return ticket
}

func TestBookingCreateHappyPath(t *testing.T) {
	f := newRouteFixture(t, 10, 0)
	t.Setenv("QSTASH_TOKEN", "test-token")
	t.Setenv("QSTASH_URL", "http://127.0.0.1:1") // unreachable — rows must stay pending
	t.Setenv("APP_URL", "https://example.com")
	t.Setenv("NODE_ENV", "test")

	body := `{"serviceId":` + strconv.Quote(f.serviceID) + `,"timeSlotId":` + strconv.Quote(f.slotID) +
		`,"seats":2,"guestName":"Ann","guestTicket":` + strconv.Quote(guestTicket(t, "rt-happy-1")) + `}`
	r := httptest.NewRequest(http.MethodPost, "/api/bookings", strings.NewReader(body))
	r.Header.Set("X-Forwarded-For", "203.0.113.21")
	w := httptest.NewRecorder()
	BookingCreate(w, r)

	if w.Code != http.StatusCreated {
		t.Fatalf("happy-path booking must be a 201, got %d (%s)", w.Code, w.Body.String())
	}
	var envelope gen.GuestBookingEnvelope
	if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("201 body must be a GuestBookingEnvelope, got %q", w.Body.String())
	}
	if envelope.Booking.ManageToken == "" {
		t.Fatal("the guest DTO must carry the manageToken (their management link)")
	}
	bookingID := contracts.UUIDString(envelope.Booking.ID)
	f.bookingIDs = append(f.bookingIDs, bookingID)

	// Seats claimed…
	var booked int
	if err := db.Pool().QueryRow(context.Background(),
		`SELECT booked_count FROM time_slots WHERE id = $1::uuid`, f.slotID).Scan(&booked); err != nil {
		t.Fatal(err)
	}
	if booked != 2 {
		t.Fatalf("booked_count = %d, want 2", booked)
	}
	// …and the fan-out rows are durable + pending (publish failed into
	// the void, so the sweeper must still see them).
	var pending int
	if err := db.Pool().QueryRow(context.Background(),
		`SELECT count(*) FROM notification_outbox
		 WHERE (payload::jsonb->>'bookingId') = $1 AND status = 'pending'`, bookingID).Scan(&pending); err != nil {
		t.Fatal(err)
	}
	if pending != 2 {
		t.Fatalf("pending outbox rows = %d, want 2 (organizer + guest)", pending)
	}
}

func TestBookingCreateSoldOutMaps409(t *testing.T) {
	f := newRouteFixture(t, 2, 2) // full slot
	t.Setenv("QSTASH_TOKEN", "test-token")
	t.Setenv("QSTASH_URL", "http://127.0.0.1:1")
	t.Setenv("APP_URL", "https://example.com")
	t.Setenv("NODE_ENV", "test")

	body := `{"serviceId":` + strconv.Quote(f.serviceID) + `,"timeSlotId":` + strconv.Quote(f.slotID) +
		`,"seats":1,"guestName":"Ann","guestTicket":` + strconv.Quote(guestTicket(t, "rt-soldout-1")) + `}`
	r := httptest.NewRequest(http.MethodPost, "/api/bookings", strings.NewReader(body))
	r.Header.Set("X-Forwarded-For", "203.0.113.22")
	w := httptest.NewRecorder()
	BookingCreate(w, r)

	if w.Code != http.StatusConflict {
		t.Fatalf("sold-out booking must be a 409, got %d (%s)", w.Code, w.Body.String())
	}
	// The dialog renders "how many are left" from the extras, not just
	// the localized copy — the wiring must carry seatsLeft through.
	b := decodeBodyError(t, w)
	seatsLeft, ok := b["seatsLeft"].(float64)
	if !ok || seatsLeft != 0 {
		t.Errorf("409 body must carry seatsLeft=0, got %v", b["seatsLeft"])
	}
	if b["error"] == "" {
		t.Error("409 must carry localized error copy")
	}
}

func TestBookingCancelUnknownTokenIs404(t *testing.T) {
	newRouteFixture(t, 10, 0) // schema must exist; the token matches nothing
	r := httptest.NewRequest(http.MethodPost, "/api/bookings/cancel",
		strings.NewReader(`{"manageToken":"`+strings.Repeat("a", 43)+`"}`))
	r.Header.Set("X-Forwarded-For", "203.0.113.23")
	w := httptest.NewRecorder()
	BookingCancel(w, r)
	if w.Code != http.StatusNotFound {
		t.Fatalf("unknown manageToken must be a 404, got %d (%s)", w.Code, w.Body.String())
	}
}
