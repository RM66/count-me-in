package httpx

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"testing"

	"countmein/pkg/contracts"
	"countmein/pkg/db"
	"countmein/pkg/demo"
)

// the error→HTTP mapping. Status codes carry meaning (403 demo,
// 404 gone, 409 conflict, 400 shape) and the body carries localized
// copy while the error class keeps its EN message for logs (ADR-011).
// An unmapped error must return nil so the caller answers a bare 500
// instead of being flattened into a misleading 4xx.

// decodeErrorBody reads a Response's JSON body into a generic map.
func decodeErrorBody(t *testing.T, resp *Response) map[string]any {
	t.Helper()
	if resp == nil {
		t.Fatal("expected a response, got nil")
	}
	raw, err := json.Marshal(resp.Body)
	if err != nil {
		t.Fatalf("marshal response body: %v", err)
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("response body must be a JSON object, got %s", raw)
	}
	return body
}

func TestBookingErrorResponse(t *testing.T) {
	cases := []struct {
		name        string
		err         error
		wantStatus  int
		wantCode    string // machine-readable extras, "" = none
		wantSeatsLt any    // nil = absent
		wantMaxSeat any
	}{
		{"demo read-only", demo.DemoReadOnlyError{}, http.StatusForbidden, contracts.DemoReadOnlyCode, nil, nil},
		{"slot gone", db.SlotNotBookableError{}, http.StatusNotFound, "", nil, nil},
		{"sold out (0 left)", db.SlotSoldOutError{SeatsLeft: 0}, http.StatusConflict, "", float64(0), nil},
		{"seats left", db.SlotSoldOutError{SeatsLeft: 3}, http.StatusConflict, "", float64(3), nil},
		{"duplicate booking", db.DuplicateBookingError{}, http.StatusConflict, "duplicate_booking", nil, nil},
		{"already cancelled", db.BookingAlreadyCancelledError{}, http.StatusConflict, "", nil, nil},
		{"manage token expired → 404 like unknown", db.ManageTokenExpiredError{}, http.StatusNotFound, "", nil, nil},
		{"invalid options", db.InvalidOptionSelectionError{Msg: "bad"}, http.StatusBadRequest, "invalid_option", nil, nil},
		{"party too large", db.PartyTooLargeError{MaxSeats: 4}, http.StatusBadRequest, "", nil, float64(4)},
	}
	for _, c := range cases {
		for _, locale := range contracts.Locales {
			resp := BookingErrorResponse(c.err, locale)
			if resp == nil {
				t.Fatalf("%s/%s: expected a mapped response", c.name, locale)
			}
			if resp.Status != c.wantStatus {
				t.Errorf("%s/%s: status = %d, want %d", c.name, locale, resp.Status, c.wantStatus)
			}
			body := decodeErrorBody(t, resp)
			msg, _ := body["error"].(string)
			if msg == "" {
				t.Errorf("%s/%s: localized error copy must not be empty", c.name, locale)
			}
			if c.wantCode != "" {
				if code, _ := body["code"].(string); code != c.wantCode {
					t.Errorf("%s/%s: code = %q, want %q", c.name, locale, code, c.wantCode)
				}
			}
			if c.wantSeatsLt != nil {
				if got, _ := body["seatsLeft"].(float64); got != c.wantSeatsLt {
					t.Errorf("%s/%s: seatsLeft = %v, want %v", c.name, locale, got, c.wantSeatsLt)
				}
			}
			if c.wantMaxSeat != nil {
				if got, _ := body["maxSeats"].(float64); got != c.wantMaxSeat {
					t.Errorf("%s/%s: maxSeats = %v, want %v", c.name, locale, got, c.wantMaxSeat)
				}
			}
		}
	}
}

// Wrapped errors must not slip past the mapping into a bare 500 —
// errors.As, not a type switch (the file's stated contract).
func TestBookingErrorResponseWrapped(t *testing.T) {
	wrapped := fmt.Errorf("booking tx: %w", db.SlotSoldOutError{SeatsLeft: 2})
	resp := BookingErrorResponse(wrapped, "en")
	if resp == nil || resp.Status != http.StatusConflict {
		t.Fatalf("wrapped SlotSoldOutError must map to 409, got %+v", resp)
	}
	wrappedDemo := fmt.Errorf("outer: %w", demo.DemoReadOnlyError{})
	resp = BookingErrorResponse(wrappedDemo, "en")
	if resp == nil || resp.Status != http.StatusForbidden {
		t.Fatalf("wrapped DemoReadOnlyError must map to 403, got %+v", resp)
	}
}

// Wrapped errors must not slip past the mapping into a bare 500 for any
// mapper in this file — errors.As, not a type switch (each mapper's
// stated contract).
func TestSlotServiceOrganizerErrorResponseWrapped(t *testing.T) {
	if resp := SlotErrorResponse(fmt.Errorf("slot tx: %w", db.SlotCapacityBelowBookedError{BookedCount: 3}), "en"); resp == nil || resp.Status != http.StatusConflict {
		t.Fatalf("wrapped SlotCapacityBelowBookedError must map to 409, got %+v", resp)
	}
	if resp := ServiceErrorResponse(fmt.Errorf("svc tx: %w", db.NoServiceUpdatesError{}), "en"); resp == nil || resp.Status != http.StatusBadRequest {
		t.Fatalf("wrapped NoServiceUpdatesError must map to 400, got %+v", resp)
	}
	if resp := OrganizerErrorResponse(fmt.Errorf("org tx: %w", db.NoOrganizerUpdatesError{}), "en"); resp == nil || resp.Status != http.StatusBadRequest {
		t.Fatalf("wrapped NoOrganizerUpdatesError must map to 400, got %+v", resp)
	}
}

func TestBookingErrorResponseUnknown(t *testing.T) {
	if resp := BookingErrorResponse(errors.New("something new"), "en"); resp != nil {
		t.Fatalf("an unmapped error must return nil (caller answers 500), got %+v", resp)
	}
}

// The body is actually localized (ADR-011): at least one locale must
// render different copy from English for the same key.
func TestBookingErrorResponseLocalized(t *testing.T) {
	err := db.SlotSoldOutError{SeatsLeft: 0}
	en := decodeErrorBody(t, BookingErrorResponse(err, "en"))["error"]
	var differs bool
	for _, locale := range contracts.Locales {
		if locale == contracts.DefaultLocale {
			continue
		}
		if other := decodeErrorBody(t, BookingErrorResponse(err, locale))["error"]; other != en {
			differs = true
			break
		}
	}
	if !differs {
		t.Error("localized copy must differ from English in at least one locale")
	}
}

func TestSlotErrorResponse(t *testing.T) {
	cases := []struct {
		name       string
		err        error
		wantStatus int
	}{
		{"no updates", db.NoSlotUpdatesError{}, http.StatusBadRequest},
		{"capacity below booked", db.SlotCapacityBelowBookedError{BookedCount: 3}, http.StatusConflict},
		{"slot has active bookings", db.SlotHasActiveBookingsError{}, http.StatusConflict},
	}
	for _, c := range cases {
		for _, locale := range contracts.Locales {
			resp := SlotErrorResponse(c.err, locale)
			if resp == nil || resp.Status != c.wantStatus {
				t.Errorf("%s/%s: status = %d, want %d", c.name, locale, respStatus(resp), c.wantStatus)
			}
			if resp != nil && decodeErrorBody(t, resp)["error"] == "" {
				t.Errorf("%s/%s: localized copy must not be empty", c.name, locale)
			}
		}
	}
	if resp := SlotErrorResponse(errors.New("other"), "en"); resp != nil {
		t.Error("unmapped slot error must return nil")
	}
}

func TestServiceErrorResponse(t *testing.T) {
	for _, locale := range contracts.Locales {
		resp := ServiceErrorResponse(db.NoServiceUpdatesError{}, locale)
		if resp == nil || resp.Status != http.StatusBadRequest {
			t.Errorf("NoServiceUpdatesError/%s: want 400, got %+v", locale, resp)
		}
	}
	if resp := ServiceErrorResponse(errors.New("other"), "en"); resp != nil {
		t.Error("unmapped service error must return nil")
	}
}

func TestOrganizerErrorResponse(t *testing.T) {
	for _, locale := range contracts.Locales {
		resp := OrganizerErrorResponse(db.NoOrganizerUpdatesError{}, locale)
		if resp == nil || resp.Status != http.StatusBadRequest {
			t.Errorf("NoOrganizerUpdatesError/%s: want 400, got %+v", locale, resp)
		}
	}
	if resp := OrganizerErrorResponse(errors.New("other"), "en"); resp != nil {
		t.Error("unmapped organizer error must return nil")
	}
}

// Internal must not leak error details into the body — the class stays
// in the log, the response is an empty 500.
func TestInternalLeaksNothing(t *testing.T) {
	resp := Internal(errors.New("secret db password: hunter2"))
	if resp.Status != http.StatusInternalServerError {
		t.Fatalf("Internal status = %d", resp.Status)
	}
	if resp.Body != nil {
		t.Fatalf("Internal must carry no body, got %+v", resp.Body)
	}
}

func respStatus(r *Response) int {
	if r == nil {
		return -1
	}
	return r.Status
}
