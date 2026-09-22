import { DEFAULT_LOCALE } from '@repo/contracts'
import { relations, sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { nanoid } from 'nanoid'
import { uuidv7 } from 'uuidv7'

export const optionsSelectMode = pgEnum('options_select_mode', ['single', 'multi'])
export const bookingStatus = pgEnum('booking_status', ['confirmed', 'cancelled'])
export const messengerKind = pgEnum('messenger_kind', ['telegram'])

/**
 * Outbox job status (architecture review fix #3 — transactional outbox).
 * A row starts `pending`, moves to `sent` once the QStash publish succeeds.
 * The sweeper job reads `pending` rows older than a short grace period
 * and re-publishes them, closing the loss window between commit and
 * the inline publish.
 */
export const outboxStatus = pgEnum('outbox_status', ['pending', 'sent', 'failed'])

/** The organizer is the Auth.js account itself; `id` is the user subject. */
export const organizers = pgTable(
  'organizers',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    messenger: messengerKind('messenger').notNull(),
    messengerId: text('messenger_id').notNull(),
    timezone: text('timezone').notNull(),
    /** Notification language (ADR-011): the locale the worker renders this organizer's messages in. */
    language: text('language').notNull().default(DEFAULT_LOCALE),
    description: text('description'),
    photoUrl: text('photo_url'),
    location: text('location'),
    contact: text('contact'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('organizers_slug_key').on(t.slug),
    uniqueIndex('organizers_messenger_id_key').on(t.messenger, t.messengerId),
    check('organizers_slug_length_check', sql`char_length(${t.slug}) <= 40`),
    check('organizers_name_length_check', sql`char_length(${t.name}) <= 100`),
    check('organizers_description_length_check', sql`char_length(${t.description}) <= 4000`),
    check('organizers_location_length_check', sql`char_length(${t.location}) <= 300`),
    check('organizers_contact_length_check', sql`char_length(${t.contact}) <= 300`),
    check('organizers_timezone_length_check', sql`char_length(${t.timezone}) <= 64`),
    check('organizers_language_length_check', sql`char_length(${t.language}) <= 8`),
  ],
)

/** Bookable offering. `id` is a short, URL-friendly text id (public URLs). */
export const services = pgTable(
  'services',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => nanoid()),
    organizerId: uuid('organizer_id')
      .notNull()
      .references(() => organizers.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    photoUrl: text('photo_url'),
    location: text('location'),
    contact: text('contact'),
    defaultPrice: text('default_price').notNull(),
    defaultCapacity: integer('default_capacity').notNull(),
    defaultDurationMinutes: integer('default_duration_minutes').notNull(),
    /**
     * Cap on how many seats a single guest may claim in one booking (party
     * size). `1` keeps the solo-only behavior; a higher value lets a guest
     * bring others without letting one person swallow the whole slot. The
     * effective ceiling at booking time is `min(maxSeatsPerBooking, seatsLeft)`.
     */
    maxSeatsPerBooking: integer('max_seats_per_booking').notNull().default(1),
    options: text('options').array(),
    optionsSelectMode: optionsSelectMode('options_select_mode'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('services_organizer_id_idx').on(t.organizerId),
    check('services_default_capacity_check', sql`${t.defaultCapacity} > 0`),
    check('services_default_duration_check', sql`${t.defaultDurationMinutes} > 0`),
    check('services_max_seats_per_booking_check', sql`${t.maxSeatsPerBooking} >= 1`),
    check('services_title_length_check', sql`char_length(${t.title}) <= 100`),
    check('services_description_length_check', sql`char_length(${t.description}) <= 2000`),
    check('services_default_price_length_check', sql`char_length(${t.defaultPrice}) <= 50`),
    check('services_location_length_check', sql`char_length(${t.location}) <= 300`),
    check('services_contact_length_check', sql`char_length(${t.contact}) <= 300`),
    /**
     * `options` non-empty implies `options_select_mode` is set — the pair is
     * patched together on the wire (RFC 7386 merge-patch) and now also in the DB.
     */
    check(
      'services_options_select_mode_check',
      sql`(${t.options} IS NULL OR array_length(${t.options}, 1) IS NULL) OR ${t.optionsSelectMode} IS NOT NULL`,
    ),
  ],
)

/** Concrete occurrence of a service: start + length; `endsAt` computed in application code. */
export const timeSlots = pgTable(
  'time_slots',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    serviceId: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    capacity: integer('capacity').notNull(),
    bookedCount: integer('booked_count').notNull().default(0),
    price: text('price'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('time_slots_service_id_idx').on(t.serviceId),
    index('time_slots_starts_at_idx').on(t.startsAt),
    index('time_slots_service_id_starts_at_idx').on(t.serviceId, t.startsAt),
    check('time_slots_duration_check', sql`${t.durationMinutes} > 0`),
    check('time_slots_capacity_check', sql`${t.capacity} >= 1`),
    check(
      'time_slots_booked_count_check',
      sql`${t.bookedCount} >= 0 and ${t.bookedCount} <= ${t.capacity}`,
    ),
    check('time_slots_price_length_check', sql`char_length(${t.price}) <= 50`),
  ],
)

/** Guest reservation on a slot (no visitor Auth.js account). */
export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    timeSlotId: uuid('time_slot_id')
      .notNull()
      .references(() => timeSlots.id, { onDelete: 'restrict' }),
    status: bookingStatus('status').notNull(),
    seats: integer('seats').notNull(),
    guestName: text('guest_name').notNull(),
    guestMessenger: messengerKind('guest_messenger').notNull(),
    guestMessengerId: text('guest_messenger_id').notNull(),
    guestMessengerLogin: text('guest_messenger_login'),
    /** The locale the guest's confirmation/cancellation messages are rendered in (ADR-011). */
    guestLocale: text('guest_locale').notNull().default(DEFAULT_LOCALE),
    manageToken: text('manage_token').notNull(),
    /**
     * SHA-256(token) hex — the lookup key for cancel and the guest
     * management page (consolidated review P1). The raw column stays
     * for the flows that must re-issue the link (booking.created job,
     * "lost my link"); see ADR-020 for the contract phase.
     */
    manageTokenHash: text('manage_token_hash').notNull(),
    selectedOptions: text('selected_options').array(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * When the manageToken stops being usable for cancellation (architecture
     * review fix #4). Set to the slot's start time plus a grace period — a
     * past event's booking does not need cancel access. `null` for rows
     * created before this column existed (treated as non-expiring).
     */
    manageTokenExpiresAt: timestamp('manage_token_expires_at', { withTimezone: true }),
  },
  (t) => [
    index('bookings_time_slot_id_idx').on(t.timeSlotId),
    index('bookings_time_slot_id_created_at_idx').on(t.timeSlotId, t.createdAt),
    index('bookings_created_at_idx').on(t.createdAt),
    index('bookings_guest_messenger_idx').on(t.guestMessenger, t.guestMessengerId),
    uniqueIndex('bookings_manage_token_key').on(t.manageToken),
    uniqueIndex('bookings_manage_token_hash_key').on(t.manageTokenHash),
    /**
     * One active booking per guest per slot. A partial unique index so a guest
     * cannot hold two `confirmed` bookings on the same slot at once — cancelled
     * bookings are excluded, so a guest who cancels and re-books is not blocked.
     * Enforced in the database so two concurrent attempts cannot both succeed;
     * the second INSERT raises a 23505 that `createGuestBooking` maps to a
     * `DuplicateBookingError`.
     */
    uniqueIndex('bookings_one_active_per_guest_per_slot')
      .on(t.timeSlotId, t.guestMessenger, t.guestMessengerId)
      .where(sql`${t.status} = 'confirmed'`),
    check('bookings_seats_check', sql`${t.seats} >= 1`),
    check('bookings_guest_name_length_check', sql`char_length(${t.guestName}) <= 100`),
    check(
      'bookings_guest_messenger_id_length_check',
      sql`char_length(${t.guestMessengerId}) <= 100`,
    ),
    check('bookings_manage_token_length_check', sql`char_length(${t.manageToken}) <= 128`),
  ],
)

export const organizersRelations = relations(organizers, ({ many }) => ({
  services: many(services),
}))

export const servicesRelations = relations(services, ({ one, many }) => ({
  organizer: one(organizers, {
    fields: [services.organizerId],
    references: [organizers.id],
  }),
  timeSlots: many(timeSlots),
}))

export const timeSlotsRelations = relations(timeSlots, ({ one, many }) => ({
  service: one(services, {
    fields: [timeSlots.serviceId],
    references: [services.id],
  }),
  bookings: many(bookings),
}))

/**
 * Transactional outbox for notification publishing (architecture review
 * fix #3). A row is written in the same transaction as the booking
 * commit, carrying the queue name and the job payload (ids only). The
 * inline publish runs after commit as before; if it fails (function
 * killed, network drop), the sweeper job (`notification.outbox.sweep`)
 * reads `pending` rows past a grace period and re-publishes them,
 * marking them `sent` on success. This closes the loss window between
 * commit and publish — a committed booking always eventually notifies.
 *
 * `attempts` counts publish tries so the sweeper can give up after a
 * bounded number of failures (logged, not retried forever).
 */
export const notificationOutbox = pgTable(
  'notification_outbox',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    /** QStash queue name (booking.created, booking.cancelled). */
    queue: text('queue').notNull(),
    /** JSON payload — the job body (ids only, no secrets). */
    payload: text('payload').notNull(),
    status: outboxStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    /** Trace id stamped on the QStash message; forwarded on sweeper republish. */
    traceId: text('trace_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [
    index('notification_outbox_status_idx').on(t.status, t.createdAt),
    check('notification_outbox_attempts_check', sql`${t.attempts} >= 0`),
  ],
)

export const bookingsRelations = relations(bookings, ({ one }) => ({
  timeSlot: one(timeSlots, {
    fields: [bookings.timeSlotId],
    references: [timeSlots.id],
  }),
}))
