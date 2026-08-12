import type { GuestTicketResponse } from '@repo/contracts'
import { NextResponse } from 'next/server'

import { validateTelegramWidget } from '@/server/auth/telegram-widget'
import { issueTicket } from '@/server/auth/ticket'

/**
 * POST /api/auth/telegram-guest
 *
 * The guest half of widget auth (ADR-002, ADR-008): validates the Telegram Login
 * Widget payload and issues a short-lived ticket proving the messenger identity.
 *
 * Deliberately **not** the same endpoint as `/telegram-signup`, even though both
 * validate the same payload: that one answers "does an organizer exist for this
 * identity" and its ticket is exchanged for an Auth.js session. A guest gets no
 * session at all — the ticket is spent on one booking or one lookup. Sharing the
 * route would mean a guest tap could be redeemed as an organizer sign-in.
 *
 * The identity is echoed back so the booking form can prefill the guest's name
 * and show who they are booking as; the booking endpoint re-reads it from the
 * ticket server-side and never trusts the echo (invariant 8).
 *
 * No seat is held here — the ticket only proves identity (docs/domain.md).
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)

  const validated = await validateTelegramWidget(body)
  if (!validated.ok) return validated.response
  const identity = validated.value

  const ticket = await issueTicket(identity)

  return NextResponse.json({
    ticket,
    messenger: identity.messenger,
    messengerId: identity.messengerId,
    displayName: identity.displayName,
  } satisfies GuestTicketResponse)
}
