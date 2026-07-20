export * from './schema.js'
export { db, client, schema } from './client.js'

import type { bookings, organizers, services, timeSlots } from './schema.js'

export type Organizer = typeof organizers.$inferSelect
export type NewOrganizer = typeof organizers.$inferInsert

export type Service = typeof services.$inferSelect
export type NewService = typeof services.$inferInsert

export type TimeSlot = typeof timeSlots.$inferSelect
export type NewTimeSlot = typeof timeSlots.$inferInsert

export type Booking = typeof bookings.$inferSelect
export type NewBooking = typeof bookings.$inferInsert
