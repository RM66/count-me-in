package routes

import (
	"countmein/pkg/httpx"
	"encoding/json"
	"net/http"
	"strings"

	jsonpatch "github.com/evanphx/json-patch"
)

// JSON Merge Patch (RFC 7386) plumbing for the three partial-update
// endpoints (ADR-016, Phase 4). The patch semantics — absent key = keep,
// explicit null = clear — come from the media type itself: the handler
// merges the patch into the current wire state, validates the *result*
// (bounds apply to the final state, which is stricter than validating the
// patch alone), and hands the db layer the merged state plus the set of
// touched keys so only intended columns are written.

// requireMergePatchContentType answers 415 unless the request declares
// the RFC 7386 media type. The semantics (absent key = keep, explicit
// null = clear) belong to the media type, not the body: a client
// sending application/json to a PUT that only speaks merge-patch would
// silently get partial-update behavior where it expected replace.
func requireMergePatchContentType(w http.ResponseWriter, r *http.Request, locale string) bool {
	ct := r.Header.Get("Content-Type")
	if ct == "" || strings.TrimSpace(strings.SplitN(ct, ";", 2)[0]) != "application/merge-patch+json" {
		httpx.Error(http.StatusUnsupportedMediaType, locale, "unsupportedMediaType").Write(w)
		return false
	}
	return true
}

// patchKeys returns the top-level keys present in a merge-patch body —
// the columns the client meant to change. ok=false for a non-object or
// empty patch: an empty patch is the "nothing to update" 400, exactly
// like the old Optional[T] flow answered it.
func patchKeys(body []byte) (map[string]bool, bool) {
	var patch map[string]json.RawMessage
	if err := json.Unmarshal(body, &patch); err != nil || patch == nil || len(patch) == 0 {
		return nil, false
	}
	keys := make(map[string]bool, len(patch))
	for k := range patch {
		keys[k] = true
	}
	return keys, true
}

// mergePatch applies RFC 7386 to the current wire state. currentState is
// a map of the entity's writable fields (values may be nil pointers —
// nulls merge the same way absent keys do for nullable columns).
func mergePatch(currentState map[string]any, patchBody []byte) ([]byte, error) {
	currentJSON, err := json.Marshal(currentState)
	if err != nil {
		return nil, err
	}
	return jsonpatch.MergePatch(currentJSON, patchBody)
}
