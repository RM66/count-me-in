-- Hot-read composite indexes + DB bounds.
--
-- Indexes:
--   time_slots(service_id, starts_at) — the public service page lists a
--     service's upcoming slots ordered by start time.
--   bookings(time_slot_id, created_at) — slot detail views order bookings
--     by creation time within a slot.
--   bookings(created_at) — the analytics window filter
--     (`getAnalyticsSummary`) scans a recent-created_at range.
--
-- Checks:
--   services: `options` non-empty implies `options_select_mode` is set
--     (the pair is validated together on the wire; now also in the DB).
--   bookings: length bounds on guest_messenger_id / manage_token.
--   organizers: length bounds on timezone / language.

CREATE INDEX IF NOT EXISTS "time_slots_service_id_starts_at_idx"
  ON "time_slots" ("service_id", "starts_at");

CREATE INDEX IF NOT EXISTS "bookings_time_slot_id_created_at_idx"
  ON "bookings" ("time_slot_id", "created_at");

CREATE INDEX IF NOT EXISTS "bookings_created_at_idx"
  ON "bookings" ("created_at");

ALTER TABLE "services"
  ADD CONSTRAINT "services_options_select_mode_check"
  CHECK (
    ("options" IS NULL OR array_length("options", 1) IS NULL)
    OR "options_select_mode" IS NOT NULL
  );

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_guest_messenger_id_length_check"
  CHECK (char_length("guest_messenger_id") <= 100);

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_manage_token_length_check"
  CHECK (char_length("manage_token") <= 128);

ALTER TABLE "organizers"
  ADD CONSTRAINT "organizers_timezone_length_check"
  CHECK (char_length("timezone") <= 64);

ALTER TABLE "organizers"
  ADD CONSTRAINT "organizers_language_length_check"
  CHECK (char_length("language") <= 8);
