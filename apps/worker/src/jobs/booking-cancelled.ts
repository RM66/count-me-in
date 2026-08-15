/**
 * `booking.cancelled` — tell the *other* party that a booking was cancelled.
 * The actor already saw the result on screen, so only the counterparty is
 * notified; the job records who cancelled and the recipient is derived from it.
 */

import {
  bookingCancelledJob,
  cancelNotificationRecipient,
  isDemoOrganizerId,
} from '@repo/contracts'

import { issueLoginLink } from '../auth/login-link'
import { getNotificationContext } from '../db/notification-context'
import type { WorkerEnv } from '../env'
import { cabinetSlotPath, loginLinkUrl, organizerPageUrl } from '../links'
import { getPostHog } from '../posthog'
import { sendMessage } from '../telegram/client'
import { bookingCancelledForGuest, bookingCancelledForOrganizer } from '../telegram/templates'

export async function handleBookingCancelled(env: WorkerEnv, data: unknown): Promise<void> {
  const parsed = bookingCancelledJob.safeParse(data)
  if (!parsed.success) {
    throw new Error(`[booking.cancelled] invalid payload: ${parsed.error.message}`)
  }

  const { bookingId, cancelledBy } = parsed.data

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

    const message = bookingCancelledForOrganizer(context, loginLinkUrl(env.appUrl, token))

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
