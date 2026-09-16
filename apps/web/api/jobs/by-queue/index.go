// POST /api/jobs/{queue} — see pkg/routes/jobs.go for the route
// logic. This file is only the Vercel entry point.
package handler

import (
	"net/http"

	"countmein/pkg/httpx"
	"countmein/pkg/routes"
)

func Handler(w http.ResponseWriter, r *http.Request) {
	httpx.Recover(routes.JobsReceiver)(w, r)
}
