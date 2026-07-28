CREATE TYPE "public"."booking_status" AS ENUM('confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."messenger_kind" AS ENUM('telegram');--> statement-breakpoint
CREATE TYPE "public"."options_select_mode" AS ENUM('single', 'multi');--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"time_slot_id" uuid NOT NULL,
	"status" "booking_status" NOT NULL,
	"seats" integer NOT NULL,
	"guest_name" text NOT NULL,
	"guest_messenger" "messenger_kind" NOT NULL,
	"guest_messenger_id" text NOT NULL,
	"guest_messenger_login" text,
	"manage_token" text NOT NULL,
	"selected_options" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_seats_check" CHECK ("bookings"."seats" >= 1)
);
--> statement-breakpoint
CREATE TABLE "organizers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"messenger" "messenger_kind" NOT NULL,
	"messenger_id" text NOT NULL,
	"timezone" text NOT NULL,
	"description" text,
	"photo_url" text,
	"location" text,
	"contact" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" text PRIMARY KEY NOT NULL,
	"organizer_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"photo_url" text,
	"location" text,
	"contact" text,
	"default_price" text NOT NULL,
	"default_capacity" integer NOT NULL,
	"default_duration_minutes" integer NOT NULL,
	"options" text[],
	"options_select_mode" "options_select_mode",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_default_capacity_check" CHECK ("services"."default_capacity" > 0),
	CONSTRAINT "services_default_duration_check" CHECK ("services"."default_duration_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "time_slots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"service_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"capacity" integer NOT NULL,
	"booked_count" integer DEFAULT 0 NOT NULL,
	"price" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_slots_duration_check" CHECK ("time_slots"."duration_minutes" > 0),
	CONSTRAINT "time_slots_capacity_check" CHECK ("time_slots"."capacity" >= 1),
	CONSTRAINT "time_slots_booked_count_check" CHECK ("time_slots"."booked_count" >= 0 and "time_slots"."booked_count" <= "time_slots"."capacity")
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_time_slot_id_time_slots_id_fk" FOREIGN KEY ("time_slot_id") REFERENCES "public"."time_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_slots" ADD CONSTRAINT "time_slots_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_time_slot_id_idx" ON "bookings" USING btree ("time_slot_id");--> statement-breakpoint
CREATE INDEX "bookings_guest_messenger_idx" ON "bookings" USING btree ("guest_messenger","guest_messenger_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_manage_token_key" ON "bookings" USING btree ("manage_token");--> statement-breakpoint
CREATE UNIQUE INDEX "organizers_slug_key" ON "organizers" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "organizers_messenger_id_key" ON "organizers" USING btree ("messenger","messenger_id");--> statement-breakpoint
CREATE INDEX "services_organizer_id_idx" ON "services" USING btree ("organizer_id");--> statement-breakpoint
CREATE INDEX "time_slots_service_id_idx" ON "time_slots" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "time_slots_starts_at_idx" ON "time_slots" USING btree ("starts_at");