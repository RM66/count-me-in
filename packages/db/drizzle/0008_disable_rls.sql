-- Disable Row Level Security (architecture review fix #2).
--
-- Migration 0004 enabled RLS on all four tables but defined no policies.
-- With no permissive policy, RLS is deny-by-default: a non-superuser
-- connection sees zero rows. The application connects with a single
-- role and enforces ownership in every SQL statement (transitive
-- ownedServiceIds / ownedSlotIds scoping in the WHERE clause), so RLS
-- was either bypassed (superuser/BYPASSRLS — dead code, false
-- confidence) or would have blocked all access.
--
-- Rather than ship a half-built security layer, RLS is dropped. If
-- defense-in-depth at the database layer is wanted later, it must be
-- done properly: FORCE ROW LEVEL SECURITY, per-request role/setting,
-- and a policy per table. See docs/architecture-review-2026.md #2.
ALTER TABLE "public"."organizers" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."services" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."time_slots" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."bookings" DISABLE ROW LEVEL SECURITY;
