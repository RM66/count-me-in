package auth

import (
	"context"
	"encoding/json"
	"time"

	"api-go/internal/contracts"
	redis "api-go/internal/redis"
)

// One-time login links: notifications deep-link into the cabinet, but
// /cabinet needs no session — without one the organizer would land in
// the read-only demo cabinet (ADR-010). Minted per send attempt; a
// retry mints a fresh token and the abandoned one simply expires.

// IssueLoginLink stores {organizerId, next} behind a fresh token.
func IssueLoginLink(ctx context.Context, organizerID, next string) (string, error) {
	token := newSecretToken()
	raw, err := json.Marshal(contracts.LoginLinkPayload{OrganizerID: organizerID, Next: next})
	if err != nil {
		return "", err
	}
	if err := redis.Client().Set(ctx, contracts.LoginLinkKey(token), raw, contracts.LoginLinkTTLSeconds*time.Second).Err(); err != nil {
		return "", err
	}
	return token, nil
}

func parseLoginLink(raw string, err error) (*contracts.LoginLinkPayload, error) {
	payload, err := missingOrBroken[contracts.LoginLinkPayload](raw, err)
	if err != nil || payload == nil {
		return nil, err
	}
	// `next` is always a relative path built server-side (open-redirect
	// guard, mirrored from the loginLinkPayload schema).
	if payload.OrganizerID == "" || len(payload.Next) == 0 || payload.Next[0] != '/' {
		return nil, nil
	}
	return payload, nil
}

// PeekLoginLink reads without consuming — the landing page must be
// able to look at a token without spending it, because link previewers
// fetch URLs before any human does.
func PeekLoginLink(ctx context.Context, token string) (*contracts.LoginLinkPayload, error) {
	raw, err := redis.Client().Get(ctx, contracts.LoginLinkKey(token)).Result()
	return parseLoginLink(raw, err)
}

// ConsumeLoginLink atomically reads and deletes (GETDEL): single-use,
// so a replayed POST cannot mint a second session.
func ConsumeLoginLink(ctx context.Context, token string) (*contracts.LoginLinkPayload, error) {
	raw, err := redis.Client().GetDel(ctx, contracts.LoginLinkKey(token)).Result()
	return parseLoginLink(raw, err)
}
