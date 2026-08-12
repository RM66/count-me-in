'use client'

import type { RegisterOrganizerInput } from '@repo/contracts'
import { useMutation } from '@tanstack/react-query'
import { signIn } from 'next-auth/react'

import { post } from './client'
import { ApiError } from './error'

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

/** Signs in with a previously issued auth ticket (consumed on use). `retry: false` — ticket is single-use. */
export function useSignInWithTicket() {
  return useMutation({
    mutationFn: async (ticket: string) => {
      const result = await signIn('telegram', { ticket, redirect: false })
      if (result?.error) {
        throw new ApiError('Could not sign you in — authenticate with Telegram again', 401)
      }
    },
    retry: false,
  })
}
