package routes

import (
	"net/http"

	"countmein/internal/contracts"
	"countmein/internal/db"
	"countmein/internal/demo"
	"countmein/internal/httpx"
	"countmein/internal/i18n"
	"countmein/internal/validation"
)

// SlotsCollection — GET/POST /api/slots. GET lists slots across every
// service of the organizer this request may view (signed-in, or demo
// for anonymous visitors, ADR-010); ?upcoming=1 drops slots that have
// already started. POST creates a slot under one of the signed-in
// organizer's services — ownership comes from the session, never the
// body: a serviceId belonging to someone else answers 404.
func SlotsCollection(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		slotsList(w, r)
	case http.MethodPost:
		slotsCreate(w, r)
	default:
		w.Header().Set("Allow", "GET, POST")
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func slotsList(w http.ResponseWriter, r *http.Request) {
	organizerID, _ := demo.ResolveCabinetOrganizerID(r)
	upcomingOnly := r.URL.Query().Get("upcoming") == "1"

	rows, err := db.ListSlots(r.Context(), organizerID, upcomingOnly)
	if err != nil {
		httpx.Internal(err).Write(w)
		return
	}
	slots := make([]contracts.TimeSlotRecord, 0, len(rows))
	for _, row := range rows {
		slots = append(slots, db.ToTimeSlotRecord(row))
	}
	httpx.JSON(http.StatusOK, map[string]any{"slots": slots}).Write(w)
}

func slotsCreate(w http.ResponseWriter, r *http.Request) {
	locale := i18n.DetectLocale(r)
	organizerID, resp := httpx.RequireWritableOrganizer(r)
	if resp != nil {
		resp.Write(w)
		return
	}

	body, _ := httpx.ReadBody(r)
	input, errs := validation.ParseCreateTimeSlotInput(body)
	if errs != nil {
		httpx.WriteInvalidBody(w, locale, errs)
		return
	}

	row, err := db.CreateSlot(r.Context(), organizerID, input)
	if err != nil {
		httpx.Internal(err).Write(w)
		return
	}
	if row == nil {
		httpx.Error(http.StatusNotFound, locale, "serviceNotFound").Write(w)
		return
	}
	httpx.JSON(http.StatusCreated, map[string]any{"slot": db.ToTimeSlotRecord(*row)}).Write(w)
}

// SlotItem — GET/PUT/DELETE /api/slots/{id}, scoped to the signed-in
// organizer through the parent service. PUT cannot move a slot to
// another service and never touches bookedCount (seats change only
// through the booking flow's atomic reserve); shrinking capacity below
// the seats already sold answers 409. DELETE cascades bookings (the
// time_slots FK); guests are not notified from here.
func SlotItem(w http.ResponseWriter, r *http.Request) {
	id := httpx.PathParam(r, "/api/slots/", "id")
	switch r.Method {
	case http.MethodGet:
		slotGet(w, r, id)
	case http.MethodPut:
		slotPut(w, r, id)
	case http.MethodDelete:
		slotDelete(w, r, id)
	default:
		w.Header().Set("Allow", "GET, PUT, DELETE")
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func slotGet(w http.ResponseWriter, r *http.Request, slotID string) {
	locale := i18n.DetectLocale(r)
	organizerID, _ := demo.ResolveCabinetOrganizerID(r)

	row, err := db.GetOwnedSlot(r.Context(), organizerID, slotID)
	if err != nil {
		httpx.Internal(err).Write(w)
		return
	}
	if row == nil {
		httpx.Error(http.StatusNotFound, locale, "slotNotFound").Write(w)
		return
	}
	httpx.JSON(http.StatusOK, map[string]any{"slot": db.ToTimeSlotRecord(*row)}).Write(w)
}

func slotPut(w http.ResponseWriter, r *http.Request, slotID string) {
	locale := i18n.DetectLocale(r)
	organizerID, resp := httpx.RequireWritableOrganizer(r)
	if resp != nil {
		resp.Write(w)
		return
	}

	body, _ := httpx.ReadBody(r)
	input, errs := validation.ParseUpdateTimeSlotInput(body)
	if errs != nil {
		httpx.WriteInvalidBody(w, locale, errs)
		return
	}

	row, err := db.UpdateOwnedSlot(r.Context(), organizerID, slotID, input)
	if err != nil {
		// One handler, two inline errors — no risk of disagreeing with
		// itself, so these live here instead of a shared mapper.
		if resp := httpx.SlotErrorResponse(err, locale); resp != nil {
			resp.Write(w)
			return
		}
		httpx.Internal(err).Write(w)
		return
	}
	if row == nil {
		httpx.Error(http.StatusNotFound, locale, "slotNotFound").Write(w)
		return
	}
	httpx.JSON(http.StatusOK, map[string]any{"slot": db.ToTimeSlotRecord(*row)}).Write(w)
}

func slotDelete(w http.ResponseWriter, r *http.Request, slotID string) {
	locale := i18n.DetectLocale(r)
	organizerID, resp := httpx.RequireWritableOrganizer(r)
	if resp != nil {
		resp.Write(w)
		return
	}

	deletedID, err := db.DeleteOwnedSlot(r.Context(), organizerID, slotID)
	if err != nil {
		if resp := httpx.SlotErrorResponse(err, locale); resp != nil {
			resp.Write(w)
			return
		}
		httpx.Internal(err).Write(w)
		return
	}
	if deletedID == "" {
		httpx.Error(http.StatusNotFound, locale, "slotNotFound").Write(w)
		return
	}
	httpx.JSON(http.StatusOK, map[string]any{"id": deletedID}).Write(w)
}
