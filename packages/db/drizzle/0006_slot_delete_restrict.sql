-- Change the bookings.time_slot_id FK from CASCADE to RESTRICT (Phase 1.2):
-- deleting a slot must not silently cascade away confirmed guest bookings.
-- The Go API now refuses the delete with a 409 while confirmed bookings exist,
-- and this constraint is the database-level backstop that makes the guard
-- impossible to bypass.
--
-- `if exists` on the drop: the constraint name is Drizzle's default
-- (bookings_time_slot_id_time_slots_id_fk); environments that already applied
-- a manual change would otherwise fail here.
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_time_slot_id_time_slots_id_fk";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_time_slot_id_time_slots_id_fk"
  FOREIGN KEY ("time_slot_id") REFERENCES "time_slots"("id") ON DELETE RESTRICT;