// GET/POST /api/services — see pkg/routes/services.go for the
// route logic. This file is only the Vercel entry point.
package handler

import (
	"net/http"

	"countmein/pkg/httpx"
	"countmein/pkg/routes"
)

func Handler(w http.ResponseWriter, r *http.Request) {
	httpx.Recover(routes.ServicesCollection)(w, r)
}
