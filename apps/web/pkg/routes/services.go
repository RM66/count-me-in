package routes

import (
	"net/http"

	gen "countmein/pkg/api/gen"
	"countmein/pkg/db"
	"countmein/pkg/demo"
	"countmein/pkg/httpx"
	"countmein/pkg/i18n"
	"countmein/pkg/storage"
	"countmein/pkg/validation"
)

// ServicesList — GET /api/services: lists the services of the organizer
// this request may view (the signed-in organizer, or the demo organizer
// for anonymous visitors, ADR-010). Method and path come from the
// generated router (pkg/api), so the handler carries no method switch.
func ServicesList(w http.ResponseWriter, r *http.Request) {
	organizerID, _ := demo.ResolveCabinetOrganizerID(r)

	rows, err := db.ListServices(r.Context(), organizerID)
	if err != nil {
		httpx.Internal(err).Write(w)
		return
	}
	services := make([]gen.ServiceRecord, 0, len(rows))
	for _, row := range rows {
		services = append(services, db.ToServiceRecord(row))
	}
	httpx.JSON(http.StatusOK, gen.ServicesEnvelope{Services: services}).Write(w)
}

// ServicesCreate — POST /api/services: creates a service owned by the
// signed-in organizer — organizerId always comes from the session, never
// from the body.
func ServicesCreate(w http.ResponseWriter, r *http.Request) {
	locale := i18n.DetectLocale(r)
	organizerID, resp := httpx.RequireWritableOrganizer(r)
	if resp != nil {
		resp.Write(w)
		return
	}

	body, _ := httpx.ReadBody(r)
	input, errs := validation.DecodeCreateServiceInput(body)
	if errs != nil {
		httpx.WriteInvalidBody(w, locale, errs)
		return
	}

	// A cover URL must live under this organizer's media prefix —
	// otherwise the row could point at an arbitrary host or another
	// organizer's object.
	if input.PhotoURL != nil && !storage.IsOwnMediaURL(organizerID, *input.PhotoURL) {
		httpx.Error(http.StatusBadRequest, locale, "photoPrefix").Write(w)
		return
	}

	row, err := db.CreateService(r.Context(), organizerID, input)
	if err != nil {
		httpx.Internal(err).Write(w)
		return
	}
	if row == nil {
		// Structurally unreachable (INSERT … RETURNING either errors or
		// returns the row) — kept as defensive parity with the TS check,
		// where drizzle's .returning() could yield an empty array.
		httpx.Error(http.StatusInternalServerError, locale, "cannotCreateService").Write(w)
		return
	}

	httpx.JSON(http.StatusCreated, gen.ServiceEnvelope{Service: db.ToServiceRecord(*row)}).Write(w)
}

// ServiceGet — GET /api/services/{id}, scoped to the organizer this
// request may view: an id belonging to someone else answers 404, not
// 403, so the endpoint never confirms that a foreign id exists.
func ServiceGet(w http.ResponseWriter, r *http.Request, serviceID string) {
	locale := i18n.DetectLocale(r)
	organizerID, _ := demo.ResolveCabinetOrganizerID(r)

	row, err := db.GetOwnedService(r.Context(), organizerID, serviceID)
	if err != nil {
		httpx.Internal(err).Write(w)
		return
	}
	if row == nil {
		httpx.Error(http.StatusNotFound, locale, "serviceNotFound").Write(w)
		return
	}
	httpx.JSON(http.StatusOK, gen.ServiceEnvelope{Service: db.ToServiceRecord(*row)}).Write(w)
}

// ServicePut — PUT /api/services/{id}. Takes a JSON Merge Patch body
// (absent key = keep, explicit null = clear, RFC 7386/ADR-016): the patch
// is validated first (a null on a non-nullable key is rejected before any
// read), then merged into the current state and the result re-validated.
func ServicePut(w http.ResponseWriter, r *http.Request, serviceID string) {
	locale := i18n.DetectLocale(r)
	organizerID, resp := httpx.RequireWritableOrganizer(r)
	if resp != nil {
		resp.Write(w)
		return
	}
	if !requireMergePatchContentType(w, r, locale) {
		return
	}

	body, _ := httpx.ReadBody(r)
	if _, errs := validation.DecodeUpdateServiceInput(body); errs != nil {
		httpx.WriteInvalidBody(w, locale, errs)
		return
	}
	touched, ok := patchKeys(body)
	if !ok {
		httpx.Error(http.StatusBadRequest, locale, "nothingToUpdate").Write(w)
		return
	}

	current, err := db.GetOwnedService(r.Context(), organizerID, serviceID)
	if err != nil {
		httpx.Internal(err).Write(w)
		return
	}
	if current == nil {
		httpx.Error(http.StatusNotFound, locale, "serviceNotFound").Write(w)
		return
	}

	merged, err := mergePatch(serviceWritableState(*current), body)
	if err != nil {
		httpx.Error(http.StatusBadRequest, locale, "invalidInput").Write(w)
		return
	}
	state, errs := validation.DecodeMergedServiceInput(merged)
	if errs != nil {
		httpx.WriteInvalidBody(w, locale, errs)
		return
	}

	// A new cover must live under this organizer's media prefix —
	// otherwise the row could point at an arbitrary host or another
	// organizer's object. Null clears and stays allowed.
	if touched["photoUrl"] && state.PhotoURL != nil &&
		!storage.IsOwnMediaURL(organizerID, *state.PhotoURL) {
		httpx.Error(http.StatusBadRequest, locale, "photoPrefix").Write(w)
		return
	}

	row, err := db.UpdateOwnedService(r.Context(), organizerID, serviceID, db.ServiceUpdate{
		State:   state,
		Touched: touched,
	})
	if err != nil {
		if resp := httpx.ServiceErrorResponse(err, locale); resp != nil {
			resp.Write(w)
			return
		}
		httpx.Internal(err).Write(w)
		return
	}
	if row == nil {
		httpx.Error(http.StatusNotFound, locale, "serviceNotFound").Write(w)
		return
	}
	httpx.JSON(http.StatusOK, gen.ServiceEnvelope{Service: db.ToServiceRecord(*row)}).Write(w)
}

// serviceWritableState renders the writable fields of a service row in
// their wire shape — the merge-patch base.
func serviceWritableState(s db.ServiceRow) map[string]any {
	return map[string]any{
		"title":                  s.Title,
		"description":            s.Description,
		"location":               s.Location,
		"contact":                s.Contact,
		"defaultPrice":           s.DefaultPrice,
		"defaultCapacity":        s.DefaultCapacity,
		"defaultDurationMinutes": s.DefaultDurationMinutes,
		"maxSeatsPerBooking":     s.MaxSeatsPerBooking,
		"options":                s.Options,
		"optionsSelectMode":      s.OptionsSelectMode,
		"photoUrl":               s.PhotoURL,
	}
}

// ServiceDelete — DELETE /api/services/{id}; cascades to slots and their
// bookings (the services FK).
func ServiceDelete(w http.ResponseWriter, r *http.Request, serviceID string) {
	locale := i18n.DetectLocale(r)
	organizerID, resp := httpx.RequireWritableOrganizer(r)
	if resp != nil {
		resp.Write(w)
		return
	}

	deletedID, err := db.DeleteOwnedService(r.Context(), organizerID, serviceID)
	if err != nil {
		httpx.Internal(err).Write(w)
		return
	}
	if deletedID == "" {
		httpx.Error(http.StatusNotFound, locale, "serviceNotFound").Write(w)
		return
	}
	httpx.JSON(http.StatusOK, gen.DeletedServiceEnvelope{ID: deletedID}).Write(w)
}
