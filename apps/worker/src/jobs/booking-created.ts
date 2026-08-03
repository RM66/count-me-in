/**
 * `booking.created` — tell one recipient that a booking exists.
 *
 * One job per recipient (see `api-contracts/jobs.ts`), so this handler always
 * sends exactly one message and a retry re-sends only to the party that failed.
 */

import { bookingCreatedJob, isDemoOrganizerId } from '@repo/api-contracts'

import { issueLoginLink } from '../auth/login-link'
import { getNotificationContext } from '../db/notification-context'
import type { WorkerEnv } from '../env'
import { cabinetSlotPath, loginLinkUrl, manageBookingUrl } from '../links'
import { sendMessage } from '../telegram/client'
import { bookingCreatedForGuest, bookingCreatedForOrganizer } from '../telegram/templates'

export async function handleBookingCreated(env: WorkerEnv, data: unknown): Promise<void> {
  const parsed = bookingCreatedJob.safeParse(data)
  if (!parsed.success) {
    // Not retryable: the payload will never become valid. Failing loudly is the
    // point — this can only be a contract mismatch between the two apps.
    throw new Error(`[booking.created] invalid payload: ${parsed.error.message}`)
  }

  const { bookingId, recipient } = parsed.data

  const context = await getNotificationContext(bookingId)
  if (!context) {
    // The booking is gone. Nothing to announce, and no retry will bring it back.
    console.warn(`[booking.created] booking ${bookingId} no longer exists — skipping`)
    return
  }

  // The demo organizer's messenger ids are sentinels, not real accounts
  // (ADR-010). Writes already reject the demo before enqueueing, so reaching
  // this line means something upstream changed — refuse rather than message a
  // stranger who might one day hold that id.
  if (isDemoOrganizerId(context.organizer.id)) {
    console.warn(`[booking.created] refusing to notify the demo organizer (${bookingId})`)
    return
  }

  if (recipient === 'organizer') {
    // Minted per attempt: a retry issues a fresh token, so a delivered message
    // never carries a button an earlier attempt already spent.
    const token = await issueLoginLink(context.organizer.id, cabinetSlotPath(context.slot.id))

    const message = bookingCreatedForOrganizer(context, loginLinkUrl(env.appUrl, token))

    await sendMessage(env.telegramBotToken, {
      chatId: context.organizer.messengerId,
      text: message.text,
      button: message.button,
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
}
