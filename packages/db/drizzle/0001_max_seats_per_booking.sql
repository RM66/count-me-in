ALTER TABLE "services" ADD COLUMN "max_seats_per_booking" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_max_seats_per_booking_check" CHECK ("services"."max_seats_per_booking" >= 1);
