/**
 * The copy of every notification, as Telegram HTML.
 *
 * Kept apart from the handlers so that "what we say" can be read and changed
 * without stepping through queue plumbing, and apart from `apps/web`'s
 * `helpers/date.ts` because that module is an app-local presentation helper
 * (AGENTS.md) — the worker renders the same instants with the same rules but
 * owns its own formatter.
 *
 * **Times are always rendered in the organizer's timezone**, for the guest too.
 * A slot is authored as "the 25th at 07:00" in the organizer's zone
 * (docs/domain.md), and that wall-clock reading is the one printed on the
 * public page the guest booked from; re-rendering it in some other zone would
 * make the confirmation disagree with the page.
 */

import {
  type CancelActor,
  effectiveContact,
  effectiveLocation,
  seatsLeft,
  slotPrice,
} from '@repo/api-contracts'
import type { Booking, Organizer, Service, TimeSlot } from '@repo/db'

import type { MessageButton } from './client'

export interface Message {
  text: string
  button?: MessageButton
}

export interface BookingView {
  booking: Booking
  slot: TimeSlot
  service: Service
  organizer: Organizer
}

/**
 * Escape the five characters that would otherwise be read as markup.
 *
 * Every interpolated value goes through this: guest names, service titles and
 * option labels are user input, and an unescaped `<` turns the whole message
 * into a `400 can't parse entities` — a delivery failure caused by a guest
 * called "Anne & Co".
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** "Sat, 25 Jul 2026, 07:00" as read in `timeZone`. */
function formatInstant(iso: Date | string, timeZone: string): string {
  const instant = iso instanceof Date ? iso : new Date(iso)

  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant)
}

/** `seats` with the right plural — appears in every message. */
function seatsLabel(seats: number): string {
  return `${seats} ${seats === 1 ? 'seat' : 'seats'}`
}

/**
 * The lines both audiences need: what, when, how many.
 *
 * Shared so a change to how a booking is described cannot land in the guest's
 * message and be forgotten in the organizer's.
 */
function bookingLines(view: BookingView): string[] {
  const { booking, slot, service, organizer } = view

  const lines = [
    `📌 <b>${escapeHtml(service.title)}</b>`,
    `🗓 ${escapeHtml(formatInstant(slot.startsAt, organizer.timezone))}`,
    `👥 ${escapeHtml(seatsLabel(booking.seats))}`,
  ]

  if (booking.selectedOptions?.length) {
    lines.push(`🔖 ${escapeHtml(booking.selectedOptions.join(', '))}`)
  }

  const price = slotPrice(slot, service)
  if (price) {
    lines.push(`💰 ${escapeHtml(price)}`)
  }

  return lines
}

/** How the organizer can reach the guest, when Telegram exposes a handle. */
function guestContactLine(booking: Booking): string {
  return booking.guestMessengerLogin
    ? `👤 ${escapeHtml(booking.guestName)} (${escapeHtml(booking.guestMessengerLogin)})`
    : `👤 ${escapeHtml(booking.guestName)}`
}

/** Where and how to reach the organizer — service value wins (docs/domain.md). */
function organizerDetailLines(view: BookingView): string[] {
  const lines: string[] = []

  const location = effectiveLocation(view.service, view.organizer)
  if (location) lines.push(`📍 ${escapeHtml(location)}`)

  const contact = effectiveContact(view.service, view.organizer)
  if (contact) lines.push(`☎️ ${escapeHtml(contact)}`)

  return lines
}

/**
 * To the organizer: someone just booked.
 *
 * Leads with the guest because that is the new information — the organizer
 * already knows their own schedule. The remaining-seats line is what makes the
 * message worth reading at a glance instead of opening the cabinet.
 */
export function bookingCreatedForOrganizer(view: BookingView, cabinetUrl: string): Message {
  const left = seatsLeft(view.slot)

  const text = [
    '🎉 <b>New booking</b>',
    '',
    guestContactLine(view.booking),
    ...bookingLines(view),
    '',
    left === 0 ? '✅ This session is now full.' : `🎟 ${escapeHtml(seatsLabel(left))} still free.`,
  ].join('\n')

  return { text, button: { text: 'Open in cabinet', url: cabinetUrl } }
}

/** To the guest: your booking is confirmed, and here is how to manage it. */
export function bookingCreatedForGuest(view: BookingView, manageUrl: string): Message {
  const text = [
    `✅ <b>Booking confirmed</b> with ${escapeHtml(view.organizer.name)}`,
    '',
    ...bookingLines(view),
    ...organizerDetailLines(view),
    '',
    'Need to change your plans? Use the button below.',
  ].join('\n')

  return { text, button: { text: 'Manage my booking', url: manageUrl } }
}

/** To the organizer: the guest cancelled, and the seats are back. */
export function bookingCancelledForOrganizer(view: BookingView, cabinetUrl: string): Message {
  const text = [
    '❌ <b>Booking cancelled</b>',
    '',
    guestContactLine(view.booking),
    ...bookingLines(view),
    '',
    `🎟 ${escapeHtml(seatsLabel(seatsLeft(view.slot)))} now free on this session.`,
  ].join('\n')

  return { text, button: { text: 'Open in cabinet', url: cabinetUrl } }
}

/**
 * To the guest: the organizer cancelled your booking.
 *
 * Carries the organizer's contact and a link back to their page: the guest did
 * not choose this, so the message's job is to explain and offer the next step,
 * not just to inform. No management link — the booking is already `cancelled`,
 * and a button to a page whose only action is "Cancel" would be nonsense.
 */
export function bookingCancelledForGuest(view: BookingView, organizerUrl: string): Message {
  const text = [
    `❌ <b>Your booking was cancelled</b> by ${escapeHtml(view.organizer.name)}`,
    '',
    ...bookingLines(view),
    ...organizerDetailLines(view),
    '',
    'Sorry about that — you can pick another session below.',
  ].join('\n')

  return { text, button: { text: 'See other sessions', url: organizerUrl } }
}

/** Human-readable actor, for log lines. */
export function describeActor(actor: CancelActor): string {
  return actor === 'guest' ? 'the guest' : 'the organizer'
}
