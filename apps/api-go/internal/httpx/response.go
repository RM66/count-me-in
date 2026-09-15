// Package httpx is route-handler plumbing shared by every Vercel
// function in api/ — responses, guards, error mapping, recovery.
// Request-level concerns only: sessions, tickets, body parsing.
// Mapping *entity* failure modes onto status codes lives in errors.go
// (the plan's internal/http/errors.go), deliberately split from the
// pure plumbing.
package httpx

import (
	"encoding/json"
	"net/http"

	"api-go/internal/contracts"
	"api-go/internal/i18n"
	"api-go/internal/logx"
	"api-go/internal/validation"
)

// Response is a ready-to-write JSON response. Guards return one
// instead of writing directly so callers keep the single-expression
// opening of the TS handlers (check for nil, never truthiness).
type Response struct {
	Status int
	Body   any // nil → empty body
}

func (r *Response) Write(w http.ResponseWriter) {
	if r == nil {
		return
	}
	if r.Body == nil {
		w.WriteHeader(r.Status)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(r.Status)
	_ = json.NewEncoder(w).Encode(r.Body)
}

func JSON(status int, body any) *Response { return &Response{Status: status, Body: body} }

func Empty(status int) *Response { return &Response{Status: status} }

func MethodNotAllowed() *Response { return Empty(http.StatusMethodNotAllowed) }

// Internal logs the error and returns an empty 500 — the Go analogue
// of an unhandled throw in a Next.js route handler (no JSON body).
func Internal(err error) *Response {
	logx.Error(err, map[string]any{"scope": "api"})
	return Empty(http.StatusInternalServerError)
}

// Error renders {error: <localized message>} — the body carries the
// caller's locale (ADR-011); machine-readable extras travel alongside.
func Error(status int, locale, key string) *Response {
	return &Response{Status: status, Body: map[string]any{
		"error": i18n.ApiError(locale, key, nil),
	}}
}

func ErrorParams(status int, locale, key string, params map[string]any) *Response {
	return &Response{Status: status, Body: map[string]any{
		"error": i18n.ApiError(locale, key, params),
	}}
}

func ErrorExtras(status int, locale, key string, params map[string]any, extras map[string]any) *Response {
	body := map[string]any{"error": i18n.ApiError(locale, key, params)}
	for k, v := range extras {
		body[k] = v
	}
	return &Response{Status: status, Body: body}
}

// DemoReadOnly — the 403 every write path answers for the demo
// account or anonymous visitors (ADR-010).
func DemoReadOnly(locale string) *Response {
	return ErrorExtras(http.StatusForbidden, locale, "demoReadOnly", nil,
		map[string]any{"code": contracts.DemoReadOnlyCode})
}

// WriteInvalidBody — parseJsonBody's 400: a localized generic as the
// top-level error, Zod-style details for logs/devtools only.
func WriteInvalidBody(w http.ResponseWriter, locale string, errs *validation.Errors) {
	if errs == nil {
		errs = &validation.Errors{}
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error":   i18n.ApiError(locale, "invalidInput", nil),
		"details": errs,
	})
}

// WriteInvalidIssues — the register route's 400: issues (fieldErrors
// only) instead of details, mirroring its TS shape.
func WriteInvalidIssues(w http.ResponseWriter, locale string, errs *validation.Errors) {
	fields := map[string][]string{}
	if errs != nil && errs.Fields != nil {
		fields = errs.Fields
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error":  i18n.ApiError(locale, "invalidInput", nil),
		"issues": fields,
	})
}
