-- manageToken expiry (architecture review fix #4).
-- The guest's manageToken was a non-expiring bearer credential. This
-- column sets an expiry relative to the slot's start time — a past
-- event's booking does not need cancel access. Nullable so existing
-- rows are treated as non-expiring (backfill is optional).
ALTER TABLE "public"."bookings" ADD COLUMN "manage_token_expires_at" timestamptz;
