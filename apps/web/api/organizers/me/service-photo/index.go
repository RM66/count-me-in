// POST /api/organizers/me/service-photo — see
// internal/routes/organizers.go for the route logic. This file is only
// the Vercel entry point.
package handler

import (
	"net/http"

	"countmein/internal/httpx"
	"countmein/internal/routes"
)

func Handler(w http.ResponseWriter, r *http.Request) {
	httpx.Recover(routes.OrganizerServicePhoto)(w, r)
}
