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

/** The organizer is the Auth.js account itself; `id` is the user subject. */
export const organizers = pgTable(
  'organizers',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    /** Messenger platform (ADR-008: identity = messenger + messengerId, no phone). */
    messenger: messengerKind('messenger').notNull(),
    /** Stable user id from the messenger platform (e.g. Telegram user id as text). */
    messengerId: text('messenger_id').notNull(),
    timezone: text('timezone').notNull(),
    description: text('description'),
    photoUrl: text('photo_url'),
    location: text('location'),
    /** Optional display-only contact info (phone, email, URL, or plain text). */
    contact: text('contact'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('organizers_slug_key').on(t.slug),
    uniqueIndex('organizers_messenger_id_key').on(t.messenger, t.messengerId),
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
    /** Optional display-only contact info; overrides organizer.contact when set. */
    contact: text('contact'),
    defaultPrice: text('default_price').notNull(),
    defaultCapacity: integer('default_capacity').notNull(),
    defaultDurationMinutes: integer('default_duration_minutes').notNull(),
    options: text('options').array(),
    optionsSelectMode: optionsSelectMode('options_select_mode'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('services_organizer_id_idx').on(t.organizerId),
    check('services_default_capacity_check', sql`${t.defaultCapacity} > 0`),
    check('services_default_duration_check', sql`${t.defaultDurationMinutes} > 0`),
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
    check('time_slots_duration_check', sql`${t.durationMinutes} > 0`),
    check('time_slots_capacity_check', sql`${t.capacity} >= 1`),
    check(
      'time_slots_booked_count_check',
      sql`${t.bookedCount} >= 0 and ${t.bookedCount} <= ${t.capacity}`,
    ),
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
      .references(() => timeSlots.id, { onDelete: 'cascade' }),
    status: bookingStatus('status').notNull(),
    seats: integer('seats').notNull(),
    guestName: text('guest_name').notNull(),
    /** Messenger platform the guest authenticated with (ADR-008). */
    guestMessenger: messengerKind('guest_messenger').notNull(),
    /** Messenger user id of the guest; used for notifications and "my bookings" lookup. */
    guestMessengerId: text('guest_messenger_id').notNull(),
    /**
     * Human-readable messenger handle the organizer can use to reach the guest
     * (Telegram @username, WhatsApp phone number, etc.). Nullable — not all
     * messenger accounts expose a public login.
     */
    guestMessengerLogin: text('guest_messenger_login'),
    manageToken: text('manage_token').notNull(),
    selectedOptions: text('selected_options').array(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('bookings_time_slot_id_idx').on(t.timeSlotId),
    index('bookings_guest_messenger_idx').on(t.guestMessenger, t.guestMessengerId),
    uniqueIndex('bookings_manage_token_key').on(t.manageToken),
    check('bookings_seats_check', sql`${t.seats} >= 1`),
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

export const bookingsRelations = relations(bookings, ({ one }) => ({
  timeSlot: one(timeSlots, {
    fields: [bookings.timeSlotId],
    references: [timeSlots.id],
  }),
}))
