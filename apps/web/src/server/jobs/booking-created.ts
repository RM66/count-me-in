/**
 * `booking.created` — tell one recipient that a booking exists.
 * One job per recipient (see `contracts/jobs.ts`), so this handler always
 * sends exactly one message and a retry re-sends only to the party that failed.
 *
 * Reached as a QStash delivery to `POST /api/jobs/booking.created`; the
 * dispatch layer (`run.ts`) has already validated the payload.
 */

import { type BookingCreatedJob, isDemoOrganizerId } from '@repo/contracts'

import { issueLoginLink } from '../auth/login-link'
import { getPostHog } from '../posthog'
import type { JobsEnv } from './env'
import { cabinetSlotPath, loginLinkUrl, manageBookingUrl } from './links'
import { getNotificationContext } from './notification-context'
import { sendMessage } from './telegram/client'
import {
  bookingCreatedForGuest,
  bookingCreatedForOrganizer,
  notificationLocale,
} from './telegram/templates'

import 'server-only'

export async function handleBookingCreated(
  env: JobsEnv,
  data: BookingCreatedJob,
): Promise<void> {
  const { bookingId, recipient } = data

  const context = await getNotificationContext(bookingId)
  if (!context) {
    console.warn(`[booking.created] booking ${bookingId} no longer exists — skipping`)
    return
  }

  if (isDemoOrganizerId(context.organizer.id)) {
    console.warn(`[booking.created] refusing to notify the demo organizer (${bookingId})`)
    return
  }

  const ph = getPostHog()

  if (recipient === 'organizer') {
    const token = await issueLoginLink(context.organizer.id, cabinetSlotPath(context.slot.id))

    const message = bookingCreatedForOrganizer(
      context,
      loginLinkUrl(env.appUrl, token),
      notificationLocale(recipient, context),
    )

    await sendMessage(env.telegramBotToken, {
      chatId: context.organizer.messengerId,
      text: message.text,
      button: message.button,
    })
    ph?.capture({
      distinctId: context.organizer.id,
      event: 'notification_sent',
      properties: { queue: 'booking.created', recipient, bookingId },
    })
    return
  }

  const message = bookingCreatedForGuest(
    context,
    manageBookingUrl(env.appUrl, context.booking.manageToken),
    notificationLocale(recipient, context),
  )

  await sendMessage(env.telegramBotToken, {
    chatId: context.booking.guestMessengerId,
    text: message.text,
    button: message.button,
  })
  ph?.capture({
    distinctId: context.organizer.id,
    event: 'notification_sent',
    properties: { queue: 'booking.created', recipient, bookingId },
  })
}
