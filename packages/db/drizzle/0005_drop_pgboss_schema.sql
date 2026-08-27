-- Drop the pg-boss schema (ADR-012): the queue moved to Upstash QStash and
-- nothing in the app talks to these tables anymore. pg-boss created its
-- schema outside Drizzle's ownership, so it appears in no snapshot — the drop
-- is written by hand rather than generated.
--
-- `if exists`: fresh environments (CI, new local clones) never had a worker
-- running, so the migration must succeed where there is nothing to drop.
DROP SCHEMA IF EXISTS "pgboss" CASCADE;
