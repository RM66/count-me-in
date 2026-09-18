-- Contract length bounds (packages/contracts BOUNDS) as CHECK constraints.
-- char_length counts code points; the API's charLen counts UTF-16 units.
-- They differ only for astral characters, where Postgres is more permissive
-- — the API still rejects what the contract rejects.
ALTER TABLE "organizers" ADD CONSTRAINT "organizers_slug_length_check" CHECK (char_length("slug") <= 40);--> statement-breakpoint
ALTER TABLE "organizers" ADD CONSTRAINT "organizers_name_length_check" CHECK (char_length("name") <= 100);--> statement-breakpoint
ALTER TABLE "organizers" ADD CONSTRAINT "organizers_description_length_check" CHECK (char_length("description") <= 4000);--> statement-breakpoint
ALTER TABLE "organizers" ADD CONSTRAINT "organizers_location_length_check" CHECK (char_length("location") <= 300);--> statement-breakpoint
ALTER TABLE "organizers" ADD CONSTRAINT "organizers_contact_length_check" CHECK (char_length("contact") <= 300);--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_title_length_check" CHECK (char_length("title") <= 100);--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_description_length_check" CHECK (char_length("description") <= 2000);--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_default_price_length_check" CHECK (char_length("default_price") <= 50);--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_location_length_check" CHECK (char_length("location") <= 300);--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_contact_length_check" CHECK (char_length("contact") <= 300);--> statement-breakpoint
ALTER TABLE "time_slots" ADD CONSTRAINT "time_slots_price_length_check" CHECK (char_length("price") <= 50);--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_guest_name_length_check" CHECK (char_length("guest_name") <= 100);
