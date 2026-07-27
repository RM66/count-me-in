/**
 * Domain logic for time slots.
 * Pure functions, no side effects, isomorphic (client + server).
 */

import type { TimeSlot } from '@repo/db'

/**
 * Calculate available seats for a slot.
 * Returns 0 if fully booked or if bookedCount exceeds capacity (data integrity issue).
 */
export function seatsLeft(slot: TimeSlot): number {
  return Math.max(0, slot.capacity - slot.bookedCount)
}

/**
 * Check if a slot has enough available seats for a booking request.
 */
export function isAvailable(slot: TimeSlot, requestedSeats: number): boolean {
  return seatsLeft(slot) >= requestedSeats
}

/**
 * Check if a slot's start time is in the past.
 * Uses current time for comparison.
 */
export function isInPast(slot: TimeSlot): boolean {
  return new Date(slot.startsAt) < new Date()
}

/**
 * Check if a slot is bookable (not in past and has available seats).
 */
export function isBookable(slot: TimeSlot, requestedSeats: number = 1): boolean {
  return !isInPast(slot) && isAvailable(slot, requestedSeats)
}

/**
 * Get fill status label for UI display.
 * - 'full': no seats left
 * - 'filling': <= 25% capacity remaining
 * - 'open': > 25% capacity remaining
 */
export function fillLabel(slot: TimeSlot): 'open' | 'filling' | 'full' {
  const left = seatsLeft(slot)
  if (left === 0) return 'full'
  if (left <= Math.ceil(slot.capacity * 0.25)) return 'filling'
  return 'open'
}

/**
 * Calculate slot end time from start + duration.
 * Returns ISO string.
 */
export function slotEnd(slot: TimeSlot): string {
  const start = new Date(slot.startsAt)
  const end = new Date(start.getTime() + slot.durationMinutes * 60_000)
  return end.toISOString()
}
