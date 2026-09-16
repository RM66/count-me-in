package jobs

import (
	"errors"
	"os"
	"strings"

	"countmein/pkg/logx"
)

// Configuration the job handlers need, read per delivery. Checked when
// a job runs rather than at boot — the receiver endpoint is a
// serverless function, so "startup" is every request. A missing
// variable must fail that delivery loudly (500 → QStash retries)
// instead of silently skipping.

type Env struct {
	TelegramBotToken string
	// Public origin used to build every link in a message (no trailing slash).
	AppURL string
}

func ReadEnv() (Env, error) {
	var e Env
	e.TelegramBotToken = strings.TrimSpace(os.Getenv("TELEGRAM_BOT_TOKEN"))
	e.AppURL = strings.TrimRight(strings.TrimSpace(os.Getenv("APP_URL")), "/")
	if e.TelegramBotToken == "" {
		logx.Info("TELEGRAM_BOT_TOKEN is not set", nil)
	}
	if e.AppURL == "" {
		logx.Info("APP_URL is not set", nil)
	}
	if e.TelegramBotToken == "" || e.AppURL == "" {
		return e, errors.New("jobs env is not configured (TELEGRAM_BOT_TOKEN / APP_URL)")
	}
	return e, nil
}
