-- Outbox skipped status.
-- In dev without QSTASH_TOKEN the inline publish is skipped (QStash POSTs
-- to APP_URL; localhost is not routable from Upstash). Skipped rows used
-- to be marked `sent`, which lied in the backlog metrics — an unsent row
-- looked delivered. `skipped` is the terminal state for rows that were
-- deliberately never published; like `sent` rows they are excluded from
-- the sweeper's `pending` filter and removed by retention.
-- (`failed` is the terminal state for rows that exhausted the retry
-- budget — abandoned, not deliberately skipped.)

ALTER TYPE "public"."outbox_status" ADD VALUE IF NOT EXISTS 'skipped';
