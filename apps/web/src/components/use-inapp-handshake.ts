'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { loadTelegramLoginScript, whenOauthSupported } from './telegram-inapp'

/** How long to wait for oauth_supported before enabling anyway. */
const INAPP_GRACE_MS = 500

/**
 * The in-app half of the OIDC flow (ADR-026): loads telegram-login.js
 * and waits for `oauth_supported` — observed module-side inside the
 * loader (telegram-inapp.ts), so a warm-up load cannot consume the
 * one-shot event. A bounded grace then enables the button anyway —
 * the click falls back to the manual popup.
 */
export function useInAppHandshake({
  inApp,
  /** Gate the whole flow on the page being able to attempt login. */
  active,
}: {
  inApp: boolean
  active: boolean
}): { inAppReady: boolean; loadFailed: boolean; retry: () => void } {
  const [inAppReady, setInAppReady] = useState(!inApp)
  const [loadFailed, setLoadFailed] = useState(false)
  const graceTimerRef = useRef<number | null>(null)
  const disposedRef = useRef(false)

  const clearGrace = useCallback(() => {
    if (graceTimerRef.current !== null) {
      clearTimeout(graceTimerRef.current)
      graceTimerRef.current = null
    }
  }, [])

  // The grace timer runs parallel to the load: a hung request must not
  // leave the button disabled forever.
  const begin = useCallback(() => {
    clearGrace()
    graceTimerRef.current = window.setTimeout(() => {
      graceTimerRef.current = null
      if (!disposedRef.current) setInAppReady(true)
    }, INAPP_GRACE_MS)
    loadTelegramLoginScript()
      .then(() => {
        if (disposedRef.current) return
        void whenOauthSupported().then(() => {
          if (!disposedRef.current) {
            clearGrace()
            setInAppReady(true)
          }
        })
      })
      .catch((err: unknown) => {
        clearGrace()
        if (!disposedRef.current) {
          // The manual popup needs no lib — unblock the button;
          // loadFailed only controls the retry affordance.
          setLoadFailed(true)
          setInAppReady(true)
        }
        console.error('[useInAppHandshake] script load failed:', err)
      })
  }, [clearGrace])

  useEffect(() => {
    if (!active || !inApp) return
    disposedRef.current = false
    begin()
    return () => {
      disposedRef.current = true
      clearGrace()
    }
  }, [active, inApp, begin, clearGrace])

  const retry = useCallback(() => {
    setLoadFailed(false)
    disposedRef.current = false
    begin()
  }, [begin])

  return { inAppReady, loadFailed, retry }
}
