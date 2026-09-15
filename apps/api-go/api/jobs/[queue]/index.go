// POST /api/jobs/{queue} — see internal/routes/jobs.go for the route
// logic. This file is only the Vercel entry point.
package handler

import (
	"net/http"

	"api-go/internal/httpx"
	"api-go/internal/routes"
)

func Handler(w http.ResponseWriter, r *http.Request) {
	httpx.Recover(routes.JobsReceiver)(w, r)
}
