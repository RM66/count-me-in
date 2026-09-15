package storage

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"

	"api-go/internal/contracts"
)

// Key builders and URL mapping, ported from @repo/media-storage/keys.
// Both avatars and service covers live under organizers/{organizerId}/,
// so one ownership check (OrganizerMediaURLPrefix) covers them.

type imageExt string

func extForContentType(contentType string) (imageExt, error) {
	switch contentType {
	case "image/jpeg":
		return "jpg", nil
	case "image/png":
		return "png", nil
	case "image/webp":
		return "webp", nil
	}
	return "", fmt.Errorf("unsupported content type: %s", contentType)
}

// randomKeySuffix mirrors randomUUID().slice(0, 8): 8 hex chars.
func randomKeySuffix() string {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		panic(errors.New("crypto/rand unavailable: " + err.Error()))
	}
	return hex.EncodeToString(b)
}

// AvatarKey — organizers/{organizerId}/avatar-{random}.{ext}.
func AvatarKey(organizerID string, ext imageExt) string {
	return fmt.Sprintf("organizers/%s/avatar-%s.%s", organizerID, randomKeySuffix(), ext)
}

// ServicePhotoKey — deliberately organizer-scoped, not
// services/{serviceId}/…: the cover is uploaded from the "new service"
// form *before* the row (and therefore the service id) exists, so the
// same ownership check validates avatars and covers alike.
func ServicePhotoKey(organizerID string, ext imageExt) string {
	return fmt.Sprintf("organizers/%s/services/photo-%s.%s", organizerID, randomKeySuffix(), ext)
}

// PublicURL maps an R2 object key to its public URL.
func PublicURL(key string) (string, error) {
	c, err := config()
	if err != nil {
		return "", err
	}
	return c.publicBaseURL + "/" + key, nil
}

// OrganizerMediaURLPrefix — the public URL prefix of everything an
// organizer owns (avatar *and* service covers).
func OrganizerMediaURLPrefix(organizerID string) (string, error) {
	c, err := config()
	if err != nil {
		return "", err
	}
	return c.publicBaseURL + "/organizers/" + organizerID + "/", nil
}

// IsOwnMediaURL validates that a client-submitted photoUrl belongs to
// this organizer's prefix — prevents pointing the row at an arbitrary
// host or another organizer's media.
func IsOwnMediaURL(organizerID, url string) bool {
	prefix, err := OrganizerMediaURLPrefix(organizerID)
	if err != nil {
		return false
	}
	return len(url) >= len(prefix) && url[:len(prefix)] == prefix
}

// CreateAvatarUpload returns a signed upload URL for an organizer's
// avatar (browser resizes/re-encodes first, then PUTs straight to R2).
func CreateAvatarUpload(ctx context.Context, organizerID string, input contracts.CreateAvatarUploadInput) (contracts.ImageUploadTarget, error) {
	ext, err := extForContentType(input.ContentType)
	if err != nil {
		return contracts.ImageUploadTarget{}, err
	}
	key := AvatarKey(organizerID, ext)
	return signedTarget(ctx, key, input.ContentType, int64(input.Size))
}

// CreateServicePhotoUpload returns a signed upload URL for a service
// cover photo (landscape covers get their own limits instead of
// reusing the avatar constants).
func CreateServicePhotoUpload(ctx context.Context, organizerID string, input contracts.CreateServicePhotoUploadInput) (contracts.ImageUploadTarget, error) {
	ext, err := extForContentType(input.ContentType)
	if err != nil {
		return contracts.ImageUploadTarget{}, err
	}
	key := ServicePhotoKey(organizerID, ext)
	return signedTarget(ctx, key, input.ContentType, int64(input.Size))
}

func signedTarget(ctx context.Context, key, contentType string, size int64) (contracts.ImageUploadTarget, error) {
	uploadURL, expiresAt, err := SignedUploadURL(ctx, key, contentType, size)
	if err != nil {
		return contracts.ImageUploadTarget{}, err
	}
	publicURL, err := PublicURL(key)
	if err != nil {
		return contracts.ImageUploadTarget{}, err
	}
	return contracts.ImageUploadTarget{
		UploadURL: uploadURL,
		PublicURL: publicURL,
		ExpiresAt: contracts.ISODate(expiresAt),
	}, nil
}
