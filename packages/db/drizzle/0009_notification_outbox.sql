-- Transactional outbox for notification publishing (architecture review fix #3).
-- A row is written in the same transaction as the booking commit. The
-- inline publish runs after commit as before; if it fails, the sweeper
-- job reads `pending` rows past a grace period and re-publishes them.
-- This closes the loss window between commit and publish.

CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'sent');--> statement-breakpoint

CREATE TABLE "public"."notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue" text NOT NULL,
	"payload" text NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"sent_at" timestamptz
);--> statement-breakpoint

CREATE INDEX "notification_outbox_status_idx" ON "public"."notification_outbox" ("status","created_at");--> statement-breakpoint

ALTER TABLE "public"."notification_outbox" ADD CONSTRAINT "notification_outbox_attempts_check" CHECK ("attempts" >= 0);
