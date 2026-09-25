package storage

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	neturl "net/url"
	"path"
	"strings"

	gen "countmein/pkg/api/gen"
	"countmein/pkg/contracts"
	"countmein/pkg/logx"
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
//
// The check parses the URL and compares host + normalized path:
// a raw prefix comparison lets
// `…/{id}/../{other}/x` through, because `..` segments are resolved by
// the HTTP client, not by the string. `url.Parse` + `path.Clean` on the
// decoded path closes that: the cleaned path must stay under the
// organizer's directory.
func IsOwnMediaURL(organizerID, url string) bool {
	prefix, err := OrganizerMediaURLPrefix(organizerID)
	if err != nil {
		return false
	}
	parsed, err := neturl.Parse(url)
	if err != nil {
		return false
	}
	prefixURL, err := neturl.Parse(prefix)
	if err != nil {
		return false
	}
	if parsed.Host != prefixURL.Host {
		return false
	}
	// Clean resolves `..` and `.` segments; the result must remain
	// inside the organizer's directory. path.Clean strips the trailing
	// slash, so the boundary is the directory itself or anything
	// beneath it — a sibling like /organizers/{id}-evil must not match.
	cleaned := path.Clean("/" + parsed.Path)
	own := strings.TrimSuffix(path.Clean(prefixURL.Path), "/") // e.g. /organizers/{id}
	return cleaned == own || strings.HasPrefix(cleaned, own+"/")
}

// MediaKeyFromURL is the inverse of PublicURL: it maps a public media
// URL back to its R2 object key (which includes the organizers/{id}/
// directory — PublicURL is base + "/" + key). It only accepts URLs
// under this organizer's own prefix (IsOwnMediaURL) — a foreign or
// malformed URL yields ("", false) and the caller must skip deletion
// rather than delete something it does not own.
func MediaKeyFromURL(organizerID, url string) (string, bool) {
	if !IsOwnMediaURL(organizerID, url) {
		return "", false
	}
	c, err := config()
	if err != nil {
		return "", false
	}
	baseURL, err := neturl.Parse(c.publicBaseURL)
	if err != nil {
		return "", false
	}
	parsed, err := neturl.Parse(url)
	if err != nil {
		return "", false
	}
	// IsOwnMediaURL already guarantees host match and a path under the
	// organizer's directory; path.Clean resolves any `.`/`..` segments
	// (they stay inside the directory by construction). The key is the
	// cleaned path minus the public base's own path prefix.
	cleaned := path.Clean("/" + parsed.Path) // e.g. /organizers/o1/avatar.png
	base := strings.TrimSuffix(path.Clean("/"+baseURL.Path), "/")
	if cleaned == base {
		return "", false // the base itself, not an object
	}
	// The organizer's own directory (or the base) is a prefix, not an
	// object — never hand back a "directory key" for deletion.
	if cleaned == base+"/organizers/"+organizerID {
		return "", false
	}
	return strings.TrimPrefix(cleaned, base+"/"), true
}

// deleteObject is a test seam: it lets the skip decisions of
// DeleteReplacedMedia be pinned without a network call to R2.
var deleteObject = DeleteObject

// DeleteReplacedMedia removes the previous image object from R2 after a
// row's photoUrl has been committed with a new value. Best-effort by
// design, mirroring the notification publisher (ADR-012): a storage
// failure must never fail an already-committed update, so errors are
// logged and swallowed. Skipped when the URL did not change, when the
// old value is empty (nothing to delete), when the old URL is not this
// organizer's media (never delete what you do not own — the old URL
// itself is not logged: it can point at foreign media), and when both
// URLs resolve to the same key: a query-string cache buster, a fragment
// or an encoded path is the same object and must not be deleted from
// under the row that now points at it.
func DeleteReplacedMedia(ctx context.Context, organizerID, oldURL, newURL string) {
	if oldURL == "" || oldURL == newURL {
		return
	}
	// Without the R2 env set, MediaKeyFromURL can only answer false —
	// report the actual cause instead of logging "not-own-media".
	if _, err := config(); err != nil {
		logx.Error(err, map[string]any{
			"organizerId": organizerID,
			"op":          "delete-replaced-media",
		})
		return
	}
	key, ok := MediaKeyFromURL(organizerID, oldURL)
	if !ok {
		logx.Info("skipped media cleanup", map[string]any{
			"organizerId": organizerID,
			"reason":      "not-own-media",
		})
		return
	}
	if newKey, ok := MediaKeyFromURL(organizerID, newURL); ok && newKey == key {
		return
	}
	if err := deleteObject(ctx, key); err != nil {
		logx.Error(err, map[string]any{
			"organizerId": organizerID,
			"key":         key,
			"op":          "delete-replaced-media",
		})
	}
}

// CreateAvatarUpload returns a signed upload URL for an organizer's
// avatar (browser resizes/re-encodes first, then PUTs straight to R2).
func CreateAvatarUpload(ctx context.Context, organizerID string, input gen.CreateAvatarUploadInput) (gen.ImageUploadTarget, error) {
	ext, err := extForContentType(string(input.ContentType))
	if err != nil {
		return gen.ImageUploadTarget{}, err
	}
	key := AvatarKey(organizerID, ext)
	return signedTarget(ctx, key, string(input.ContentType), int64(input.Size))
}

// CreateServicePhotoUpload returns a signed upload URL for a service
// cover photo (landscape covers get their own limits instead of
// reusing the avatar constants).
func CreateServicePhotoUpload(ctx context.Context, organizerID string, input gen.CreateServicePhotoUploadInput) (gen.ImageUploadTarget, error) {
	ext, err := extForContentType(string(input.ContentType))
	if err != nil {
		return gen.ImageUploadTarget{}, err
	}
	key := ServicePhotoKey(organizerID, ext)
	return signedTarget(ctx, key, string(input.ContentType), int64(input.Size))
}

func signedTarget(ctx context.Context, key, contentType string, size int64) (gen.ImageUploadTarget, error) {
	uploadURL, expiresAt, err := SignedUploadURL(ctx, key, contentType, size)
	if err != nil {
		return gen.ImageUploadTarget{}, err
	}
	publicURL, err := PublicURL(key)
	if err != nil {
		return gen.ImageUploadTarget{}, err
	}
	return gen.ImageUploadTarget{
		UploadURL: uploadURL,
		PublicURL: publicURL,
		ExpiresAt: contracts.ISODate(expiresAt),
	}, nil
}
