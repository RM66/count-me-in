package jobs

import (
	"context"

	"countmein/pkg/auth"
	"countmein/pkg/contracts"
	"countmein/pkg/db"
	"countmein/pkg/logx"
)

// booking.created — tell one recipient that a booking exists. One job
// per recipient (see contracts/jobs.go), so this handler always sends
// exactly one message and a retry re-sends only to the party that
// failed. Reached as a QStash delivery to POST /api/jobs/booking.created;
// the dispatch layer (run.go) has already validated the payload.

// HandleBookingCreated notifies one recipient about a fresh booking.
// PostHog captures from the TS handler are not ported (no SDK in the
// dependency set); delivery logging covers the remainder.
func HandleBookingCreated(ctx context.Context, env Env, job contracts.BookingCreatedJob) error {
	booking, slot, service, organizer, err := db.GetBookingChain(ctx, job.BookingID)
	if err != nil {
		return err
	}
	// Deliberately a fresh read at send time: a job that waited out a
	// retry backoff must render the booking as it is now, not as it was
	// when the transaction committed.
	if booking == nil {
		logx.Info("booking no longer exists — skipping", map[string]any{
			"queue": contracts.QueueBookingCreated, "bookingId": job.BookingID,
		})
		return nil
	}
	view := BookingView{Booking: *booking, Slot: *slot, Service: *service, Organizer: *organizer}

	// Demo bookings never reach a chat (ADR-010).
	if contracts.IsDemoOrganizerID(organizer.ID) {
		logx.Info("refusing to notify the demo organizer", map[string]any{
			"queue": contracts.QueueBookingCreated, "bookingId": job.BookingID,
		})
		return nil
	}

	if job.Recipient == contracts.RecipientOrganizer {
		// Minted per send attempt: a retry mints a fresh token and the
		// abandoned one simply expires, so a delivered message never
		// carries a button already spent by an earlier attempt.
		token, err := auth.IssueLoginLink(ctx, organizer.ID, CabinetSlotPath(slot.ID))
		if err != nil {
			return err
		}
		locale := NotificationLocale(contracts.RecipientOrganizer, view)
		message := BookingCreatedForOrganizer(view, LoginLinkURL(env.AppURL, token), locale)
		return SendMessage(ctx, env.TelegramBotToken, organizer.MessengerID, message.Text, message.Button)
	}

	locale := NotificationLocale(contracts.RecipientGuest, view)
	message := BookingCreatedForGuest(view, ManageBookingURL(env.AppURL, booking.ManageToken), locale)
	return SendMessage(ctx, env.TelegramBotToken, booking.GuestMessengerID, message.Text, message.Button)
}
