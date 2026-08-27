/**
 * `booking.cancelled` — tell the *other* party that a booking was cancelled.
 * The actor already saw the result on screen, so only the counterparty is
 * notified; the job records who cancelled and the recipient is derived from it.
 *
 * Reached as a QStash delivery to `POST /api/jobs/booking.cancelled`; the
 * dispatch layer (`run.ts`) has already validated the payload.
 */

import {
  type BookingCancelledJob,
  cancelNotificationRecipient,
  isDemoOrganizerId,
} from '@repo/contracts'

import { issueLoginLink } from '../auth/login-link'
import { getPostHog } from '../posthog'
import type { JobsEnv } from './env'
import { cabinetSlotPath, loginLinkUrl, organizerPageUrl } from './links'
import { getNotificationContext } from './notification-context'
import { sendMessage } from './telegram/client'
import {
  bookingCancelledForGuest,
  bookingCancelledForOrganizer,
  notificationLocale,
} from './telegram/templates'

import 'server-only'

export async function handleBookingCancelled(
  env: JobsEnv,
  data: BookingCancelledJob,
): Promise<void> {
  const { bookingId, cancelledBy } = data

  const context = await getNotificationContext(bookingId)
  if (!context) {
    console.warn(`[booking.cancelled] booking ${bookingId} no longer exists — skipping`)
    return
  }

  if (isDemoOrganizerId(context.organizer.id)) {
    console.warn(`[booking.cancelled] refusing to notify the demo organizer (${bookingId})`)
    return
  }

  const recipient = cancelNotificationRecipient(cancelledBy)
  const ph = getPostHog()

  if (recipient === 'organizer') {
    const token = await issueLoginLink(context.organizer.id, cabinetSlotPath(context.slot.id))

    const message = bookingCancelledForOrganizer(
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
      properties: { queue: 'booking.cancelled', recipient, bookingId },
    })
    return
  }

  const message = bookingCancelledForGuest(
    context,
    organizerPageUrl(env.appUrl, context.organizer.slug),
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
    properties: { queue: 'booking.cancelled', recipient, bookingId },
  })
}
