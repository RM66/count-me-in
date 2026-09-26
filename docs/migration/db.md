# DB inventory (Phase 1.3): tables, columns, raw SQL

Schema owner: `packages/db/src/schema.ts` (Drizzle) — Python never owns the schema, only mirrors it in `db/tables.py` (Phase 3.4, verified by reflection test).

## Tables (Drizzle `pgTable` names)

| Table                 | Key columns (Drizzle field → column)                                                                                                                                                                                                                                           | Constraints / indexes (from schema.ts)          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `organizers`          | id (uuid pk), slug (unique), name, messenger, messenger_id (unique w/ messenger), timezone, language, description, photo_url, location, contact, created_at                                                                                                                    | unique `(messenger, messenger_id)`; slug unique |
| `services`            | id (pk), organizer_id (fk organizers, cascade), title, description, photo_url, location, contact, default_price, default_capacity, default_duration_minutes, max_seats_per_booking, options (jsonb), options_select_mode, created_at                                           | fk cascade delete                               |
| `time_slots`          | id (pk), service_id (fk services, cascade), starts_at (timestamptz), duration_minutes, capacity, booked_count, price, created_at                                                                                                                                               | fk cascade delete                               |
| `bookings`            | id (pk), time_slot_id (fk time_slots), status (`confirmed`\|`cancelled`), seats, guest_name, guest_messenger, guest_messenger_id, guest_messenger_login, guest_locale, manage_token, manage_token_hash (unique), selected_options (jsonb), created_at, manage_token_expires_at | unique `manage_token_hash`; fk to time_slots    |
| `notification_outbox` | id (pk), queue, payload (jsonb), status (`pending`/`sent`/`skipped`/`failed`), attempts, trace_id, created_at, sent_at                                                                                                                                                         | index on status/created_at for sweep            |

## Raw SQL in `pkg/db/*.go` (verbatim, to be reused as SQLAlchemy Core / `text()`)

The Go layer uses squirrel-style builders; the SQL shapes below are the exact semantics that must be preserved. The critical one first:

**Atomic seat reserve** (`booking_writes.go`, inside the booking transaction — never read-check-write):

```sql
UPDATE time_slots SET booked_count = booked_count + :seats
WHERE id = :id AND booked_count + :seats <= capacity
RETURNING booked_count
```

**Booking insert** (`booking_writes.go`): `INSERT INTO bookings (…) VALUES (…) RETURNING id` — manage token + hash + expiry written here.

**Duplicate-booking guard**: `SELECT EXISTS (… FROM bookings WHERE time_slot_id = :slot AND guest_messenger_id = :guest AND status = 'confirmed')`.

**Cancel path**: `UPDATE bookings SET status = 'cancelled' WHERE id = :id AND status = 'confirmed'` + seat release `UPDATE time_slots SET booked_count = booked_count - :seats WHERE id = :slot` in one transaction; outbox row inserted in the same tx.

**Delete guards** (`DeleteOwnedSlot`, `DeleteOwnedService`): count referencing booking rows (confirmed **and** cancelled); a stray `23503` foreign-key violation maps to the same 409. `DELETE FROM services WHERE id = :id AND organizer_id = :org RETURNING photo_url` (photo returned for media cleanup).

**Outbox** (`outbox.go`): `INSERT INTO notification_outbox (queue, payload, status, attempts, trace_id) VALUES (…, 'pending', 0, …)`; `UPDATE notification_outbox SET status = 'sent', sent_at = now() WHERE id = :id`; `UPDATE … SET status='skipped'` (dev, terminal); `UPDATE … SET status='failed'` (terminal); `UPDATE … SET attempts = attempts + 1 WHERE id = :id RETURNING attempts`; sweep claim: `UPDATE … SET status='pending' … WHERE status='pending' AND created_at < :cutoff` with `FOR UPDATE SKIP LOCKED` semantics (two concurrent sweepers must not double-claim); retention: `DELETE FROM notification_outbox WHERE sent_at < :cutoff`; backlog metrics: `SELECT status, count(*) … GROUP BY status`.

**Media prefix check** (`media.go`): `PhotoURLReferenced` — `SELECT count(*) FROM organizers WHERE photo_url = :url` + `SELECT count(*) FROM services WHERE photo_url = :url` (prefix-based ownership check, not uniqueness).

**Reads**: `SELECT … FROM organizers WHERE id = :id`; `SELECT … FROM services WHERE id = :id AND organizer_id = :org`; `SELECT … FROM time_slots WHERE id = :id`; slot list with optional `starts_at >= now()` filter (`upcoming=1`); `SELECT ts.id FROM time_slots ts JOIN services …` for ownership checks; guest booking list by messenger identity; `SELECT id FROM services WHERE organizer_id = :org` (ownership); `SELECT booked_count FROM time_slots WHERE id = :id` (capacity checks inside tx).

**Seed** (`seed.go`): demo reseed — delete demo organizer's services/slots/bookings and re-insert from the same layout as `packages/db/src/seed/demo.ts`.

**Organizer/service/slot partial updates**: `UPDATE organizers SET <touched columns> WHERE id = :id`; `UPDATE organizers SET language = :lang WHERE id = :id`; `UPDATE organizers SET photo_url = :url WHERE id = :id`; `UPDATE services SET <touched> WHERE id = :id AND organizer_id = :org`; `UPDATE services SET photo_url = :url …`; `UPDATE time_slots SET <touched> WHERE id = :id AND service_id IN (SELECT id FROM services WHERE organizer_id = :org)` — merged state validated before write, only touched columns written (merge-patch, RFC 7386).

**Existence checks**: `SELECT EXISTS (SELECT 1 FROM organizers WHERE messenger = :m AND messenger_id = :mid)` (registration duplicate identity); slug uniqueness via insert conflict mapping to 409.

## Transaction / pooling rules to preserve

- `db.Pool()` is a lazy process singleton; panics on missing `POSTGRES_URL` (healthz recovers it into 503).
- Booking + cancel are single transactions: reserve/insert/outbox (or cancel/release/outbox) commit atomically; QStash publish happens **after** commit and absorbs its own errors.
- Python: `create_async_engine(..., poolclass=NullPool, connect_args={"prepare_threshold": None, "connect_timeout": 5})` — safe behind transaction-mode poolers.
