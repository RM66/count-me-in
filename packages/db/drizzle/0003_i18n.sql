ALTER TABLE "bookings" ADD COLUMN "guest_locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizers" ADD COLUMN "language" text DEFAULT 'en' NOT NULL;
