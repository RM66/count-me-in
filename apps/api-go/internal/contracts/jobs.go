package contracts

// QStash queue names (ADR-012) — the {queue} path segment of the
// receiver route; the publisher builds its destination from them.
const (
	QueueBookingCreated   = "booking.created"
	QueueBookingCancelled = "booking.cancelled"
	QueueDemoRefresh      = "demo.refresh"
)

// Recurring demo seed refresh, shortly after midnight UTC.
const DemoRefreshCron = "17 0 * * *"

type NotificationRecipient string

const (
	RecipientOrganizer NotificationRecipient = "organizer"
	RecipientGuest     NotificationRecipient = "guest"
)

type CancelActor string

const (
	ActorGuest     CancelActor = "guest"
	ActorOrganizer CancelActor = "organizer"
)

// CancelNotificationRecipient — the party to notify about a
// cancellation: whoever did not perform it.
func CancelNotificationRecipient(by CancelActor) NotificationRecipient {
	if by == ActorGuest {
		return RecipientOrganizer
	}
	return RecipientGuest
}

// Job payloads carry ids only, never snapshots: the handler refetches
// the Booking → TimeSlot → Service → Organizer chain at send time.

type BookingCreatedJob struct {
	BookingID string                `json:"bookingId"`
	Recipient NotificationRecipient `json:"recipient"`
}

type BookingCancelledJob struct {
	BookingID   string      `json:"bookingId"`
	CancelledBy CancelActor `json:"cancelledBy"`
}
