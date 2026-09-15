package jobs

import (
	"context"

	"api-go/internal/auth"
	"api-go/internal/contracts"
	"api-go/internal/db"
	"api-go/internal/logx"
)

// booking.cancelled — tell the *other* party that a booking was
// cancelled: the actor already saw the result on screen, so only the
// counterparty is notified; the job records who cancelled and the
// recipient is derived from it.

func HandleBookingCancelled(ctx context.Context, env Env, job contracts.BookingCancelledJob) error {
	booking, slot, service, organizer, err := db.GetBookingChain(ctx, job.BookingID)
	if err != nil {
		return err
	}
	if booking == nil {
		logx.Info("booking no longer exists — skipping", map[string]any{
			"queue": contracts.QueueBookingCancelled, "bookingId": job.BookingID,
		})
		return nil
	}
	view := BookingView{Booking: *booking, Slot: *slot, Service: *service, Organizer: *organizer}

	if contracts.IsDemoOrganizerID(organizer.ID) {
		logx.Info("refusing to notify the demo organizer", map[string]any{
			"queue": contracts.QueueBookingCancelled, "bookingId": job.BookingID,
		})
		return nil
	}

	recipient := contracts.CancelNotificationRecipient(job.CancelledBy)

	if recipient == contracts.RecipientOrganizer {
		token, err := auth.IssueLoginLink(ctx, organizer.ID, CabinetSlotPath(slot.ID))
		if err != nil {
			return err
		}
		locale := NotificationLocale(contracts.RecipientOrganizer, view)
		message := BookingCancelledForOrganizer(view, LoginLinkURL(env.AppURL, token), locale)
		return SendMessage(ctx, env.TelegramBotToken, organizer.MessengerID, message.Text, message.Button)
	}

	locale := NotificationLocale(contracts.RecipientGuest, view)
	message := BookingCancelledForGuest(view, OrganizerPageURL(env.AppURL, organizer.Slug), locale)
	return SendMessage(ctx, env.TelegramBotToken, booking.GuestMessengerID, message.Text, message.Button)
}
