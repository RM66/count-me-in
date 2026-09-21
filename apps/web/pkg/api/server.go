// Package api assembles the Go API from the oapi-codegen artifacts
// (ADR-016): the generated std-http router dispatches every operation,
// and thin adapters forward to the handlers in pkg/routes with the
// extracted path params.
package api

import (
	"net/http"

	gen "countmein/pkg/api/gen"
)

// NewMux builds the generated router: every operation from the spec,
// dispatched through the StrictServerInterface's non-strict twin to the
// existing handlers. The patterns are method-scoped ("POST /api/services",
// "GET /api/services/{id}", …), so method routing comes from the spec too.
func NewMux() http.Handler {
	return gen.Handler(newAdapters())
}
