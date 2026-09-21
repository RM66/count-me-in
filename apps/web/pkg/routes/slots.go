package routes

import (
	"net/http"

	gen "countmein/pkg/api/gen"
	"countmein/pkg/contracts"
	"countmein/pkg/db"
	"countmein/pkg/demo"
	"countmein/pkg/httpx"
	"countmein/pkg/i18n"
	"countmein/pkg/validation"
)

// SlotsList — GET /api/slots: lists slots across every service of the
// organizer this request may view (signed-in, or demo for anonymous
// visitors, ADR-010). ?upcoming=1 drops slots that have already started;
// the query parameter is parsed and bound by the generated router into
// `params`, so it is read from there and nowhere else.
func SlotsList(w http.ResponseWriter, r *http.Request, params gen.ListSlotsParams) {
	organizerID, _ := demo.ResolveCabinetOrganizerID(r)
	upcomingOnly := params.Upcoming != nil && string(*params.Upcoming) == "1"

	rows, err := db.ListSlots(r.Context(), organizerID, upcomingOnly)
	if err != nil {
		httpx.Internal(err).Write(w)
		return
	}
	slots := make([]gen.TimeSlotRecord, 0, len(rows))
	for _, row := range rows {
		slots = append(slots, db.ToTimeSlotRecord(row))
	}
	httpx.JSON(http.StatusOK, gen.SlotsEnvelope{Slots: slots}).Write(w)
}

// SlotsCreate — POST /api/slots: creates a slot under one of the
// signed-in organizer's services — ownership comes from the session,
// never the body: a serviceId belonging to someone else answers 404.
func SlotsCreate(w http.ResponseWriter, r *http.Request) {
	locale := i18n.DetectLocale(r)
	organizerID, resp := httpx.RequireWritableOrganizer(r)
	if resp != nil {
		resp.Write(w)
		return
	}

	body, _ := httpx.ReadBody(r)
	input, errs := validation.DecodeCreateTimeSlotInput(body)
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
	httpx.JSON(http.StatusCreated, gen.SlotEnvelope{Slot: db.ToTimeSlotRecord(*row)}).Write(w)
}

// SlotGet — GET /api/slots/{id}, scoped to the organizer this request may
// view through the parent service.
func SlotGet(w http.ResponseWriter, r *http.Request, slotID string) {
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
	httpx.JSON(http.StatusOK, gen.SlotEnvelope{Slot: db.ToTimeSlotRecord(*row)}).Write(w)
}

// SlotPut — PUT /api/slots/{id}. Cannot move a slot to another service and
// never touches bookedCount (seats change only through the booking flow's
// atomic reserve); shrinking capacity below the seats already sold answers
// 409. Takes a JSON Merge Patch body (RFC 7386/ADR-016): the patch is
// validated, merged into the current state, and the result re-validated.
func SlotPut(w http.ResponseWriter, r *http.Request, slotID string) {
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
	if _, errs := validation.DecodeUpdateTimeSlotInput(body); errs != nil {
		httpx.WriteInvalidBody(w, locale, errs)
		return
	}
	touched, ok := patchKeys(body)
	if !ok {
		httpx.Error(http.StatusBadRequest, locale, "nothingToUpdate").Write(w)
		return
	}

	current, err := db.GetOwnedSlot(r.Context(), organizerID, slotID)
	if err != nil {
		httpx.Internal(err).Write(w)
		return
	}
	if current == nil {
		httpx.Error(http.StatusNotFound, locale, "slotNotFound").Write(w)
		return
	}

	merged, err := mergePatch(slotWritableState(*current), body)
	if err != nil {
		httpx.Error(http.StatusBadRequest, locale, "invalidInput").Write(w)
		return
	}
	state, errs := validation.DecodeMergedSlotInput(merged, touched["startsAt"])
	if errs != nil {
		httpx.WriteInvalidBody(w, locale, errs)
		return
	}

	row, err := db.UpdateOwnedSlot(r.Context(), organizerID, slotID, db.SlotUpdate{
		State:   state,
		Touched: touched,
	})
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
	httpx.JSON(http.StatusOK, gen.SlotEnvelope{Slot: db.ToTimeSlotRecord(*row)}).Write(w)
}

// slotWritableState renders the writable fields of a slot row in their
// wire shape — the merge-patch base. startsAt is the ISO string the row
// already carries; a patch may replace it with an epoch number.
func slotWritableState(s db.TimeSlotRow) map[string]any {
	return map[string]any{
		"startsAt":        contracts.ISODate(s.StartsAt),
		"durationMinutes": s.DurationMinutes,
		"capacity":        s.Capacity,
		"price":           s.Price,
	}
}

// SlotDelete — DELETE /api/slots/{id}. Refuses a slot that still has
// confirmed bookings (409 — the organizer must cancel them first); the
// time_slots FK is RESTRICT, so the database would reject the delete
// anyway. Guests are not notified from here.
func SlotDelete(w http.ResponseWriter, r *http.Request, slotID string) {
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
	httpx.JSON(http.StatusOK, gen.DeletedSlotEnvelope{ID: contracts.ToUUID(deletedID)}).Write(w)
}
