-- Outbox trace_id + legacy manageToken expiry backfill (review follow-ups).

-- trace_id: the inline publish stamps the QStash message with a trace id;
-- a sweeper re-publish (the case where tracing matters most — delivery
-- after a failed inline attempt) used to send an empty one. Store the
-- trace id on the row so the republish forwards it.
ALTER TABLE "notification_outbox" ADD COLUMN IF NOT EXISTS "trace_id" text;

-- Legacy manageToken rows created before the expiry column existed are
-- `manage_token_expires_at IS NULL` = non-expiring (review P1-8). A
-- token's usable window is the slot start + 24h grace; for legacy rows
-- the slot start is the best available bound, so backfill from it.
UPDATE "bookings" b
SET "manage_token_expires_at" = ts.starts_at + interval '24 hours'
FROM "time_slots" ts
WHERE b.time_slot_id = ts.id
  AND b.manage_token_expires_at IS NULL;
