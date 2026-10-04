/**
 * The bookings table's sortable columns, shared by the server page (which
 * validates `?sort=` before the API call) and the client table (which renders
 * the sortable headers). A plain module, not the client hook file — a server
 * component importing a runtime value from a `'use client'` module gets a
 * client reference, not the array.
 */
export const SORT_KEYS = ['guest', 'service', 'when', 'seats', 'status'] as const

export type SortKey = (typeof SORT_KEYS)[number]
export type BookingSort = SortKey
