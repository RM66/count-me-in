package routes

import (
	"net/http"
	"strings"
	"time"

	"countmein/pkg/auth"
	"countmein/pkg/contracts"
	"countmein/pkg/db"
	"countmein/pkg/demo"
	"countmein/pkg/httpx"
	"countmein/pkg/i18n"
	"countmein/pkg/storage"
	"countmein/pkg/validation"
)

// OrganizerRegister — POST /api/organizers (ADR-008). The messenger
// identity comes from the auth ticket (validated server-side via the
// Telegram widget HMAC — never from the client). The ticket is only
// peeked here — it stays valid so the client can immediately exchange
// it for a session via Auth.js (signIn('telegram', {ticket}) consumes it).
func OrganizerRegister(w http.ResponseWriter, r *http.Request) {
	locale := i18n.DetectLocale(r)
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	body, _ := httpx.ReadBody(r)
	input, errs := validation.ParseRegisterOrganizerInput(body)
	if errs != nil {
		httpx.WriteInvalidIssues(w, locale, errs)
		return
	}

	identity, err := auth.PeekTicket(r.Context(), input.Ticket)
	if err != nil {
		httpx.Internal(err).Write(w)
		return
	}
	if identity == nil {
		httpx.Error(http.StatusUnauthorized, locale, "authSessionExpired").Write(w)
		return
	}

	registered, err := db.InsertOrganizer(r.Context(), input, *identity)
	if err != nil {
		// Unique violations (23505): slug vs messenger identity, told
		// apart by constraint name.
		if unique := db.UniqueViolation(err); unique != nil {
			if strings.Contains(unique.ConstraintName, "slug") {
				httpx.Error(http.StatusConflict, locale, "slugTaken").Write(w)
			} else {
				httpx.Error(http.StatusConflict, locale, "accountExists").Write(w)
			}
			return
		}
		httpx.Internal(err).Write(w)
		return
	}

	httpx.JSON(http.StatusCreated, contracts.Registered{Organizer: registered}).Write(w)
}

// OrganizerMe — GET/PUT /api/organizers/me. GET returns the organizer
// this request may view: the signed-in organizer, or the demo organizer
// with isDemo: true for anonymous visitors (/cabinet is open to everyone
// and renders the read-only demo, ADR-010). Writes are never inferred
// from the GET response: PUT re-checks the session independently.
func OrganizerMe(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		organizerMeGet(w, r)
	case http.MethodPut:
		organizerMePut(w, r)
	default:
		w.Header().Set("Allow", "GET, PUT")
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func organizerMeGet(w http.ResponseWriter, r *http.Request) {
	locale := i18n.DetectLocale(r)
	organizerID, isDemo := demo.ResolveCabinetOrganizerID(r)

	row, err := db.GetOrganizerProfile(r.Context(), organizerID)
	if err != nil {
		httpx.Internal(err).Write(w)
		return
	}
	if row == nil {
		// For the demo id this means the seed has not been run.
		if isDemo {
			httpx.Error(http.StatusNotFound, locale, "demoNotSeeded").Write(w)
		} else {
			httpx.Error(http.StatusNotFound, locale, "organizerNotFound").Write(w)
		}
		return
	}

	httpx.JSON(http.StatusOK, map[string]any{
		"organizer": db.ToOrganizerProfile(*row, isDemo),
	}).Write(w)
}

func organizerMePut(w http.ResponseWriter, r *http.Request) {
	locale := i18n.DetectLocale(r)
	organizerID, resp := httpx.RequireWritableOrganizer(r)
	if resp != nil {
		resp.Write(w)
		return
	}

	body, _ := httpx.ReadBody(r)
	input, errs := validation.ParseUpdateOrganizerProfileInput(body)
	if errs != nil {
		httpx.WriteInvalidBody(w, locale, errs)
		return
	}

	// A new avatar must live under this organizer's media prefix —
	// otherwise the row could point at an arbitrary host or another
	// organizer's object. Null clears and stays allowed.
	if input.PhotoURL.Set && input.PhotoURL.Value != nil &&
		!storage.IsOwnMediaURL(organizerID, *input.PhotoURL.Value) {
		httpx.Error(http.StatusBadRequest, locale, "photoPrefix").Write(w)
		return
	}

	row, err := db.UpdateOrganizerProfile(r.Context(), organizerID, input)
	if err != nil {
		if resp := httpx.OrganizerErrorResponse(err, locale); resp != nil {
			resp.Write(w)
			return
		}
		httpx.Internal(err).Write(w)
		return
	}
	if row == nil {
		httpx.Error(http.StatusNotFound, locale, "organizerNotFound").Write(w)
		return
	}

	httpx.JSON(http.StatusOK, map[string]any{
		"organizer": db.ToOrganizerProfile(*row, false),
	}).Write(w)
}

// OrganizerMeLanguage — PATCH /api/organizers/me/language (ADR-011).
// The language switcher's server action calls this to persist the
// organizer's notification language — the last write that lived in the
// TS server layer, now moved to the Go API (Phase 3.2). The cookie is
// already set by the action; this syncs the column so notification jobs
// render in the right locale. Silent no-op for an unknown id (0 rows
// affected); demo/anonymous callers are refused by RequireWritableOrganizer.
func OrganizerMeLanguage(w http.ResponseWriter, r *http.Request) {
	locale := i18n.DetectLocale(r)
	if r.Method != http.MethodPatch {
		w.Header().Set("Allow", http.MethodPatch)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	organizerID, resp := httpx.RequireWritableOrganizer(r)
	if resp != nil {
		resp.Write(w)
		return
	}

	body, _ := httpx.ReadBody(r)
	language, errs := validation.ParseUpdateOrganizerLanguageInput(body)
	if errs != nil {
		httpx.WriteInvalidBody(w, locale, errs)
		return
	}

	if err := db.UpdateOrganizerLanguage(r.Context(), organizerID, language); err != nil {
		httpx.Internal(err).Write(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// OrganizerAvatar — POST /api/organizers/me/avatar: a signed upload URL
// for the current organizer's avatar (uploadUrl, publicUrl, expiresAt).
// Read-only demo (ADR-010): denied before handing out an R2 upload URL,
// otherwise the demo avatar could be overwritten. Anonymous callers are
// demo cabinet visitors, so they get the same refusal.
func OrganizerAvatar(w http.ResponseWriter, r *http.Request) {
	locale := i18n.DetectLocale(r)
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	organizerID, resp := httpx.RequireWritableOrganizer(r)
	if resp != nil {
		resp.Write(w)
		return
	}
	if !httpx.RateLimited(w, r, "rl:avatar:"+organizerID, httpx.RateLimitConfig{Limit: 10, Window: time.Hour}) {
		return
	}

	body, _ := httpx.ReadBody(r)
	input, errs := validation.ParseCreateAvatarUploadInput(body)
	if errs != nil {
		httpx.WriteInvalidBody(w, locale, errs)
		return
	}

	target, err := storage.CreateAvatarUpload(r.Context(), organizerID, input)
	if err != nil {
		httpx.Internal(err).Write(w)
		return
	}
	httpx.JSON(http.StatusOK, target).Write(w)
}

// OrganizerServicePhoto — POST /api/organizers/me/service-photo: a
// signed upload URL for a service cover photo. Lives under organizers/me
// rather than services/{id} on purpose: the "new service" form uploads a
// cover *before* the service row exists, so the only identity available
// is the organizer's. The resulting key is organizer-scoped, which is
// also what the photoUrl ownership check validates.
func OrganizerServicePhoto(w http.ResponseWriter, r *http.Request) {
	locale := i18n.DetectLocale(r)
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	organizerID, resp := httpx.RequireWritableOrganizer(r)
	if resp != nil {
		resp.Write(w)
		return
	}
	if !httpx.RateLimited(w, r, "rl:service-photo:"+organizerID, httpx.RateLimitConfig{Limit: 10, Window: time.Hour}) {
		return
	}

	body, _ := httpx.ReadBody(r)
	input, errs := validation.ParseCreateServicePhotoUploadInput(body)
	if errs != nil {
		httpx.WriteInvalidBody(w, locale, errs)
		return
	}

	target, err := storage.CreateServicePhotoUpload(r.Context(), organizerID, input)
	if err != nil {
		httpx.Internal(err).Write(w)
		return
	}
	httpx.JSON(http.StatusOK, target).Write(w)
}
