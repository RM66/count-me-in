package jobs

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"time"
)

// Telegram Bot API client — just sendMessage, over net/http. No SDK:
// one endpoint, one method, and a dependency here would be more code
// to audit than the request it replaces.
//
// The interesting part is the error classification. A notification job
// that retries everything is worse than one that retries nothing: the
// single most common failure is a recipient who never pressed Start on
// the bot (a bot may only message users who did), and that never
// becomes deliverable no matter how many times it is tried.

// MessageButton is a link rendered as a tappable button under the message.
type MessageButton struct {
	Text string
	URL  string
}

// TelegramUnreachableError — not worth retrying. Covers both "never
// started the bot" (403) and "chat not found" (400): from the
// receiver's point of view they are the same event — the recipient
// cannot be messaged, and the job is done as well as it ever will be.
type TelegramUnreachableError struct {
	ChatID      string
	Description string
}

func (e *TelegramUnreachableError) Error() string {
	return fmt.Sprintf("Telegram cannot reach chat %s: %s", e.ChatID, e.Description)
}

// TelegramTransientError — rate limit, outage, network. The job retries.
type TelegramTransientError struct {
	Message string
}

func (e *TelegramTransientError) Error() string { return e.Message }

type telegramResponse struct {
	OK          bool   `json:"ok"`
	Description string `json:"description"`
	ErrorCode   int    `json:"error_code"`
}

var chatNotFoundRe = regexp.MustCompile(`(?i)chat not found`)

var telegramHTTPClient = &http.Client{Timeout: 10 * time.Second}

// SendMessage sends one message. link_preview_options.is_disabled
// keeps Telegram from unfurling the cabinet or booking URL: the
// preview would be a screenshot-sized card for a page that requires
// the recipient's own credentials, and — for the one-time login link —
// a preview fetch is exactly the robot request the POST-to-consume
// design exists to defeat.
func SendMessage(ctx context.Context, botToken, chatID, text string, button *MessageButton) error {
	body := map[string]any{
		"chat_id":              chatID,
		"text":                 text,
		"parse_mode":           "HTML",
		"link_preview_options": map[string]any{"is_disabled": true},
	}
	if button != nil {
		body["reply_markup"] = map[string]any{
			"inline_keyboard": [][]map[string]string{{{"text": button.Text, "url": button.URL}}},
		}
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.telegram.org/bot"+botToken+"/sendMessage", bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	res, err := telegramHTTPClient.Do(req)
	if err != nil {
		return &TelegramTransientError{Message: "Telegram request failed: " + err.Error()}
	}
	defer res.Body.Close()
	payloadRaw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<16))
	var payload telegramResponse
	_ = json.Unmarshal(payloadRaw, &payload)

	if res.StatusCode >= 200 && res.StatusCode < 300 && payload.OK {
		return nil
	}

	description := payload.Description
	if description == "" {
		description = fmt.Sprintf("HTTP %d", res.StatusCode)
	}

	if res.StatusCode == http.StatusForbidden ||
		(res.StatusCode == http.StatusBadRequest && chatNotFoundRe.MatchString(description)) {
		return &TelegramUnreachableError{ChatID: chatID, Description: description}
	}
	if res.StatusCode == http.StatusTooManyRequests || res.StatusCode >= 500 {
		return &TelegramTransientError{Message: fmt.Sprintf("Telegram %d: %s", res.StatusCode, description)}
	}
	return fmt.Errorf("Telegram rejected the message (%d): %s", res.StatusCode, description)
}
