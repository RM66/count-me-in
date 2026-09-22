-- manageToken hashing (consolidated review P1, glm/hy4/mimo/muse).
--
-- The token is a password-equivalent credential: whoever holds it can
-- cancel the booking. Storing it in the clear meant a database dump
-- leaked live cancel links. `manage_token_hash` stores SHA-256(token)
-- hex; lookups (cancel, guest management page) go through the hash.
--
-- Expand phase: the raw `manage_token` column stays for the two flows
-- that legitimately need the raw value (the booking.created job builds
-- the deep link; ListGuestBookings re-issues links in the "lost my
-- link" flow). The contract phase (dropping the raw column) requires
-- re-issuing tokens through the notification flow only — see ADR-020.

ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "manage_token_hash" text;

UPDATE "bookings"
SET "manage_token_hash" = encode(sha256(convert_to("manage_token", 'UTF8')), 'hex')
WHERE "manage_token_hash" IS NULL;

ALTER TABLE "bookings"
  ALTER COLUMN "manage_token_hash" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "bookings_manage_token_hash_key"
  ON "bookings" ("manage_token_hash");
