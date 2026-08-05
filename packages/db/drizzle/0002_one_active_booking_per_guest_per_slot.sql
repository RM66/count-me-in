-- One active booking per guest per slot.
-- A partial unique index so that a guest cannot hold two `confirmed` bookings
-- on the same slot at once. Cancelled bookings are excluded (`WHERE status =
-- 'confirmed'`), so a guest who cancels and re-books is not blocked. Enforced in
-- the database rather than in JS so two concurrent booking attempts cannot
-- both succeed — the second INSERT raises a 23505 unique violation that
-- `createGuestBooking` maps to a `DuplicateBookingError`.
CREATE UNIQUE INDEX "bookings_one_active_per_guest_per_slot"
	ON "bookings" ("time_slot_id", "guest_messenger", "guest_messenger_id")
	WHERE "bookings"."status" = 'confirmed';--> statement-breakpoint
