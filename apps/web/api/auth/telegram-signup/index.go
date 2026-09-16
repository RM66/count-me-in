// POST /api/auth/telegram-signup — see pkg/routes/auth.go for the
// route logic. This file is only the Vercel entry point.
package handler

import (
	"net/http"

	"countmein/pkg/httpx"
	"countmein/pkg/routes"
)

func Handler(w http.ResponseWriter, r *http.Request) {
	httpx.Recover(routes.TelegramSignup)(w, r)
}
