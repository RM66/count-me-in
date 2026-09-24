-- Outbox terminal status.
-- Rows past the retry budget used to stay `pending` forever, clogging
-- the sweeper's LIMIT batch (head-of-line blocking). `failed` is the
-- terminal state for abandoned rows; the sweeper also deletes `sent`
-- rows past a retention window so the table does not grow unbounded.

ALTER TYPE "public"."outbox_status" ADD VALUE IF NOT EXISTS 'failed';
