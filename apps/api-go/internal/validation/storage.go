package validation

import (
	"encoding/json"

	"api-go/internal/contracts"
)

func jsonUnmarshalString(raw json.RawMessage, v *string) error {
	return json.Unmarshal(raw, v)
}

// Max size of the *resized* payload accepted by the signed PUT.
const (
	AvatarUploadMaxBytes       = 1024 * 1024
	ServicePhotoUploadMaxBytes = 2 * 1024 * 1024
)

// ParseCreateAvatarUploadInput — browser resizes/re-encodes, then asks
// for a signed PUT; size guards the resized payload, not the source.
func ParseCreateAvatarUploadInput(body []byte) (contracts.CreateAvatarUploadInput, *Errors) {
	m, e := rawObject(body)
	if e != nil {
		return contracts.CreateAvatarUploadInput{}, e
	}
	e = NewErrors()
	var out contracts.CreateAvatarUploadInput
	out.ContentType, _ = strValue(e, m, "contentType", true, false, ContentTypeRule)
	size, _ := intValue(e, m, "size", true, intRange(1, AvatarUploadMaxBytes))
	out.Size = int(size)
	return out, e.Finish()
}

// ParseCreateServicePhotoUploadInput — landscape covers get their own
// limit instead of reusing the avatar constants.
func ParseCreateServicePhotoUploadInput(body []byte) (contracts.CreateServicePhotoUploadInput, *Errors) {
	m, e := rawObject(body)
	if e != nil {
		return contracts.CreateServicePhotoUploadInput{}, e
	}
	e = NewErrors()
	var out contracts.CreateServicePhotoUploadInput
	out.ContentType, _ = strValue(e, m, "contentType", true, false, ContentTypeRule)
	size, _ := intValue(e, m, "size", true, intRange(1, ServicePhotoUploadMaxBytes))
	out.Size = int(size)
	return out, e.Finish()
}
