'use client'

import type { Messenger, RegisterOrganizerInput, VerifyOtpResponse } from '@repo/api-contracts'
import { useMutation } from '@tanstack/react-query'
import { signIn } from 'next-auth/react'

import { ApiError } from '../error'
import { post } from '../client'

/**
 * Hook for requesting an OTP code.
 * Sends a code to the user's messenger (Telegram by default).
 */
export function useRequestOtp() {
  return useMutation({
    mutationFn: ({ phone, messenger = 'telegram' }: { phone: string; messenger?: Messenger }) =>
      post<{ ok: true }>('/api/otp/request', { phone, messenger }),
  })
}

/**
 * Hook for verifying an OTP code.
 * Returns a one-time ticket and whether an organizer exists for this phone.
 */
export function useVerifyOtp() {
  return useMutation({
    mutationFn: ({ phone, code }: { phone: string; code: string }) =>
      post<VerifyOtpResponse>('/api/otp/verify', { phone, code }),
  })
}

/**
 * Hook for registering a new organizer.
 * Requires a valid phone-ownership ticket from OTP verification.
 */
export function useRegisterOrganizer() {
  return useMutation({
    mutationFn: (input: RegisterOrganizerInput) =>
      post<{ organizer: { id: string; slug: string } }>('/api/organizers', input),
  })
}

/**
 * Hook for signing in with a phone-ownership ticket.
 * Exchanges the ticket for an Auth.js session (consumes the ticket).
 */
export function useSignInWithTicket() {
  return useMutation({
    mutationFn: async (ticket: string) => {
      const result = await signIn('otp-ticket', { ticket, redirect: false })
      if (result?.error) {
        throw new ApiError('Could not sign you in — verify your phone again', 401)
      }
    },
  })
}
