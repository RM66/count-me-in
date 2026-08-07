/**
 * `booking.created` — tell one recipient that a booking exists.
 * One job per recipient (see `api-contracts/jobs.ts`), so this handler always
 * sends exactly one message and a retry re-sends only to the party that failed.
 */

import { bookingCreatedJob, isDemoOrganizerId } from '@repo/api-contracts'

import { issueLoginLink } from '../auth/login-link'
import { getNotificationContext } from '../db/notification-context'
import type { WorkerEnv } from '../env'
import { cabinetSlotPath, loginLinkUrl, manageBookingUrl } from '../links'
import { getPostHog } from '../posthog'
import { sendMessage } from '../telegram/client'
import { bookingCreatedForGuest, bookingCreatedForOrganizer } from '../telegram/templates'

export async function handleBookingCreated(env: WorkerEnv, data: unknown): Promise<void> {
  const parsed = bookingCreatedJob.safeParse(data)
  if (!parsed.success) {
    throw new Error(`[booking.created] invalid payload: ${parsed.error.message}`)
  }

  const { bookingId, recipient } = parsed.data

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

    const message = bookingCreatedForOrganizer(context, loginLinkUrl(env.appUrl, token))

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
