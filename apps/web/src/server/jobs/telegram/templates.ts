/**
 * The rendering side of every notification, as Telegram HTML.
 *
 * The copy itself lives in `@repo/translations` (data, not queue plumbing);
 * this module keeps what belongs to the notification job: the ICU translator,
 * HTML composition around `t()` results, the time formatter, and the
 * per-recipient locale policy. Times are rendered here rather than through
 * `helpers/date.ts` because that module is a browser-facing presentation
 * helper (AGENTS.md) — the job renders the same instants with the same rules
 * but owns its own formatter.
 *
 * **Language (ADR-011).** Every message is ICU-rendered in one of the app
 * locales. Which locale applies is per recipient: the organizer reads their
 * own `organizers.language`, the guest reads the locale they booked the page
 * in (`bookings.guestLocale`) — resolved by {@link notificationLocale} at send
 * time from the freshly refetched rows.
 *
 * **Times are always rendered in the organizer's timezone**, for the guest too.
 * A slot is authored as "the 25th at 07:00" in the organizer's zone
 * (docs/domain.md), and that wall-clock reading is the one printed on the
 * public page the guest booked from; re-rendering it in some other zone would
 * make the confirmation disagree with the page. Only the *labels* follow the
 * locale, never the zone.
 */

import {
  type AppLocale,
  type CancelActor,
  DEFAULT_LOCALE,
  effectiveContact,
  effectiveLocation,
  isAppLocale,
  type NotificationRecipient,
  seatsLeft,
  slotPrice,
} from '@repo/contracts'
import type { Booking, Organizer, Service, TimeSlot } from '@repo/db'
import { NOTIFICATION_MESSAGES, type NotificationMessages } from '@repo/translations'
import { createTranslator } from 'next-intl'

import type { MessageButton } from './client'

import 'server-only'

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

/**
 * The locale a recipient reads: the organizer's own `language`, the guest's
 * captured `guestLocale` — validated against the supported set because both
 * columns are free text in Postgres and a stale value must not break `Intl`.
 */
export function notificationLocale(recipient: NotificationRecipient, view: BookingView): AppLocale {
  const stored = recipient === 'organizer' ? view.organizer.language : view.booking.guestLocale
  return isAppLocale(stored) ? stored : DEFAULT_LOCALE
}

/** "Sat, 25 Jul 2026, 07:00" as read in `timeZone`, labels in `locale`. */
function formatInstant(iso: Date | string, timeZone: string, locale: AppLocale): string {
  const instant = iso instanceof Date ? iso : new Date(iso)

  return new Intl.DateTimeFormat(locale, {
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

type Templates = ReturnType<typeof createTranslator<NotificationMessages>>

/**
 * The lines both audiences need: what, when, how many.
 * Shared so a change to how a booking is described cannot land in the guest's
 * message and be forgotten in the organizer's.
 *
 * HTML tags live here in code, not in the ICU messages: use-intl reads
 * `<tag>` pairs as rich-text placeholders, which is the wrong tool for
 * Telegram HTML. Only user-supplied values are escaped — tags composed here
 * are trusted markup.
 */
function bookingLines(view: BookingView, t: Templates, locale: AppLocale): string[] {
  const { booking, slot, service, organizer } = view

  const lines = [
    `📌 <b>${escapeHtml(service.title)}</b>`,
    `🗓 ${escapeHtml(formatInstant(slot.startsAt, organizer.timezone, locale))}`,
    `👥 ${t('seats', { count: booking.seats })}`,
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
 * Leads with the guest because that is the new information — the organizer
 * already knows their own schedule. The remaining-seats line is what makes the
 * message worth reading at a glance instead of opening the cabinet.
 */
export function bookingCreatedForOrganizer(
  view: BookingView,
  cabinetUrl: string,
  locale: AppLocale,
): Message {
  const t = createTranslator({ locale, messages: NOTIFICATION_MESSAGES[locale] })
  const left = seatsLeft(view.slot)

  const text = [
    `🎉 <b>${t('createdOrganizer.title')}</b>`,
    '',
    guestContactLine(view.booking),
    ...bookingLines(view, t, locale),
    '',
    left === 0 ? t('createdOrganizer.full') : t('createdOrganizer.stillFree', { count: left }),
  ].join('\n')

  return { text, button: { text: t('createdOrganizer.button'), url: cabinetUrl } }
}

/** To the guest: your booking is confirmed, and here is how to manage it. */
export function bookingCreatedForGuest(
  view: BookingView,
  manageUrl: string,
  locale: AppLocale,
): Message {
  const t = createTranslator({ locale, messages: NOTIFICATION_MESSAGES[locale] })

  const text = [
    `✅ <b>${t('createdGuest.title')}</b> ${t('createdGuest.withName', {
      name: escapeHtml(view.organizer.name),
    })}`,
    '',
    ...bookingLines(view, t, locale),
    ...organizerDetailLines(view),
    '',
    t('createdGuest.footer'),
  ].join('\n')

  return { text, button: { text: t('createdGuest.button'), url: manageUrl } }
}

/** To the organizer: the guest cancelled, and the seats are back. */
export function bookingCancelledForOrganizer(
  view: BookingView,
  cabinetUrl: string,
  locale: AppLocale,
): Message {
  const t = createTranslator({ locale, messages: NOTIFICATION_MESSAGES[locale] })

  const text = [
    `❌ <b>${t('cancelledOrganizer.title')}</b>`,
    '',
    guestContactLine(view.booking),
    ...bookingLines(view, t, locale),
    '',
    t('cancelledOrganizer.freed', { count: seatsLeft(view.slot) }),
  ].join('\n')

  return { text, button: { text: t('cancelledOrganizer.button'), url: cabinetUrl } }
}

/**
 * To the guest: the organizer cancelled your booking.
 * Carries the organizer's contact and a link back to their page: the guest did
 * not choose this, so the message's job is to explain and offer the next step.
 * No management link — the booking is already `cancelled`.
 */
export function bookingCancelledForGuest(
  view: BookingView,
  organizerUrl: string,
  locale: AppLocale,
): Message {
  const t = createTranslator({ locale, messages: NOTIFICATION_MESSAGES[locale] })

  const text = [
    `❌ <b>${t('cancelledGuest.title')}</b> ${t('cancelledGuest.byName', {
      name: escapeHtml(view.organizer.name),
    })}`,
    '',
    ...bookingLines(view, t, locale),
    ...organizerDetailLines(view),
    '',
    t('cancelledGuest.footer'),
  ].join('\n')

  return { text, button: { text: t('cancelledGuest.button'), url: organizerUrl } }
}

/** Human-readable actor, for log lines. */
export function describeActor(actor: CancelActor): string {
  return actor === 'guest' ? 'the guest' : 'the organizer'
}
