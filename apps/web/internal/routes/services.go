package routes

import (
	"net/http"

	"countmein/internal/contracts"
	"countmein/internal/db"
	"countmein/internal/demo"
	"countmein/internal/httpx"
	"countmein/internal/i18n"
	"countmein/internal/storage"
	"countmein/internal/validation"
)

// ServicesCollection — GET/POST /api/services. GET lists the services
// of the organizer this request may view (the signed-in organizer, or
// the demo organizer for anonymous visitors, ADR-010). POST creates a
// service owned by the signed-in organizer — organizerId always comes
// from the session, never from the body.
func ServicesCollection(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		servicesList(w, r)
	case http.MethodPost:
		servicesCreate(w, r)
	default:
		w.Header().Set("Allow", "GET, POST")
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func servicesList(w http.ResponseWriter, r *http.Request) {
	organizerID, _ := demo.ResolveCabinetOrganizerID(r)

	rows, err := db.ListServices(r.Context(), organizerID)
	if err != nil {
		httpx.Internal(err).Write(w)
		return
	}
	services := make([]contracts.ServiceRecord, 0, len(rows))
	for _, row := range rows {
		services = append(services, db.ToServiceRecord(row))
	}
	httpx.JSON(http.StatusOK, map[string]any{"services": services}).Write(w)
}

func servicesCreate(w http.ResponseWriter, r *http.Request) {
	locale := i18n.DetectLocale(r)
	organizerID, resp := httpx.RequireWritableOrganizer(r)
	if resp != nil {
		resp.Write(w)
		return
	}

	body, _ := httpx.ReadBody(r)
	input, errs := validation.ParseCreateServiceInput(body)
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

	httpx.JSON(http.StatusCreated, map[string]any{"service": db.ToServiceRecord(*row)}).Write(w)
}

// ServiceItem — GET/PUT/DELETE /api/services/{id}, scoped to the
// signed-in organizer: an id belonging to someone else answers 404, not
// 403, so the endpoint never confirms that a foreign id exists. PUT
// follows the profile convention (absent key = untouched, explicit null
// clears). DELETE cascades to slots and their bookings (the services FK).
func ServiceItem(w http.ResponseWriter, r *http.Request) {
	id := httpx.PathParam(r, "/api/services/")
	switch r.Method {
	case http.MethodGet:
		serviceGet(w, r, id)
	case http.MethodPut:
		servicePut(w, r, id)
	case http.MethodDelete:
		serviceDelete(w, r, id)
	default:
		w.Header().Set("Allow", "GET, PUT, DELETE")
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func serviceGet(w http.ResponseWriter, r *http.Request, serviceID string) {
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
	httpx.JSON(http.StatusOK, map[string]any{"service": db.ToServiceRecord(*row)}).Write(w)
}

func servicePut(w http.ResponseWriter, r *http.Request, serviceID string) {
	locale := i18n.DetectLocale(r)
	organizerID, resp := httpx.RequireWritableOrganizer(r)
	if resp != nil {
		resp.Write(w)
		return
	}

	body, _ := httpx.ReadBody(r)
	input, errs := validation.ParseUpdateServiceInput(body)
	if errs != nil {
		httpx.WriteInvalidBody(w, locale, errs)
		return
	}

	if input.PhotoURL.Set && input.PhotoURL.Value != nil &&
		!storage.IsOwnMediaURL(organizerID, *input.PhotoURL.Value) {
		httpx.Error(http.StatusBadRequest, locale, "photoPrefix").Write(w)
		return
	}

	row, err := db.UpdateOwnedService(r.Context(), organizerID, serviceID, input)
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
	httpx.JSON(http.StatusOK, map[string]any{"service": db.ToServiceRecord(*row)}).Write(w)
}

func serviceDelete(w http.ResponseWriter, r *http.Request, serviceID string) {
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
	httpx.JSON(http.StatusOK, map[string]any{"id": deletedID}).Write(w)
}
