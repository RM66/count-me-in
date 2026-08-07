'use client'

import { useCallback, useSyncExternalStore } from 'react'

/**
 * Analytics cookie consent (GDPR/ePrivacy opt-in).
 * `null` = undecided (banner shows). Stored in localStorage, not a cookie,
 * so the consent record itself never needs consent.
 */
export type CookieConsent = 'accepted' | 'rejected'

const STORAGE_KEY = 'cmi_cookie_consent'
const listeners = new Set<() => void>()

function readConsent(): CookieConsent | null {
  if (typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value === 'accepted' || value === 'rejected' ? value : null
  } catch {
    return null
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useCookieConsent() {
  const consent = useSyncExternalStore(subscribe, readConsent, () => null)

  const setConsent = useCallback((value: CookieConsent) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, value)
    } catch {
      // Storage unavailable (private mode / disabled) — treat as session-only choice.
    }
    listeners.forEach((listener) => listener())
  }, [])

  return {
    consent,
    accept: useCallback(() => setConsent('accepted'), [setConsent]),
    reject: useCallback(() => setConsent('rejected'), [setConsent]),
  }
}
