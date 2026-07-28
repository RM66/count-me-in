'use client'

import type { AuthTicketResponse, RegisterOrganizerInput } from '@repo/api-contracts'
import { useMutation } from '@tanstack/react-query'
import { signIn } from 'next-auth/react'

import { post } from '../client'
import { ApiError } from '../error'

/**
 * Validates the Telegram Login Widget payload server-side (HMAC) and returns
 * a short-lived auth ticket plus whether an organizer exists for this identity.
 * Call this from the TelegramLoginButton callback in the auth pages.
 */
export function useValidateTelegramWidget() {
  return useMutation({
    mutationFn: (widgetData: Record<string, unknown>) =>
      post<AuthTicketResponse>('/api/auth/telegram-signup', widgetData),
  })
}

/**
 * Registers a new organizer. The messenger identity is derived server-side
 * from the auth ticket (never trusted from the client).
 */
export function useRegisterOrganizer() {
  return useMutation({
    mutationFn: (input: RegisterOrganizerInput) =>
      post<{ organizer: { id: string; slug: string } }>('/api/organizers', input),
  })
}

/**
 * Signs in with a previously issued auth ticket.
 * Exchanges the ticket for an Auth.js JWT session (ticket is consumed).
 */
export function useSignInWithTicket() {
  return useMutation({
    mutationFn: async (ticket: string) => {
      const result = await signIn('telegram', { ticket, redirect: false })
      if (result?.error) {
        throw new ApiError('Could not sign you in — authenticate with Telegram again', 401)
      }
    },
  })
}
