'use client'

import type { RegisterOrganizerInput } from '@repo/contracts'
import { useMutation } from '@tanstack/react-query'
import { signIn } from 'next-auth/react'

import { post } from './client'
import { ApiError } from './error'

/**
 * Last-resort fallback for an Auth.js sign-in failure. api-client has no
 * locale to translate with, so the display site (use-signup-form) translates
 * by status; this keeps logs and devtools readable when that path is missed.
 * A named constant rather than an inline literal so the lint rule treats it as
 * an intentional, documented fallback.
 */
const SIGN_IN_ERROR_FALLBACK = 'Could not sign you in — authenticate with Telegram again'

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
        throw new ApiError(SIGN_IN_ERROR_FALLBACK, 401)
      }
    },
    retry: false,
  })
}
