'use client'

import { useCallback, useEffect, useRef } from 'react'

import { OIDC_ORIGIN, openTelegramAuthPopup, type TelegramAuthResult } from './telegram-oidc'

const POPUP_CLOSE_POLL_MS = 200

/**
 * The manual-popup half of the OIDC flow (ADR-026): opens our own /auth
 * URL (the stock lib omits `origin`), listens for the `auth_result`
 * postMessage, and watches for the popup closing without a result.
 *
 * `popupRef` survives a detected close: a result queued just before
 * the popup closed must still pass the listener's source check.
 */
export function useTelegramPopup({
  onResult,
}: {
  onResult: (result: TelegramAuthResult) => void
}): {
  openPopup: (opts: { clientId: string; nonce: string; lang?: string }) => boolean
} {
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult
  const popupRef = useRef<Window | null>(null)
  const pollerRef = useRef<number | null>(null)

  useEffect(() => {
    // The result listener — registered for the component's lifetime so a
    // result can never land before it exists.
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== OIDC_ORIGIN) return
      const popup = popupRef.current
      if (!popup || ev.source !== popup) return
      let data: unknown = ev.data
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data)
        } catch {
          return
        }
      }
      const msg = data as { event?: string; result?: unknown; error?: string } | null
      if (!msg || msg.event !== 'auth_result') return
      if (pollerRef.current !== null) {
        clearInterval(pollerRef.current)
        pollerRef.current = null
      }
      if (typeof msg.error === 'string') {
        onResultRef.current({ error: msg.error })
      } else if (typeof msg.result === 'string') {
        onResultRef.current({ id_token: msg.result })
      } else {
        // A bot still in legacy-widget mode posts a payload *object*,
        // not a JWT — the likeliest failure mid-cutover. Log the shape
        // (never the value) so that window is observable.
        console.error(
          '[useTelegramPopup] auth_result with non-string result:',
          msg.result === null ? 'null' : typeof msg.result,
        )
        onResultRef.current({ error: 'missing id_token' })
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      if (pollerRef.current !== null) {
        clearInterval(pollerRef.current)
        pollerRef.current = null
      }
      // A popup completed after unmount must not act on stale state
      // (VerifyStep hidden on slot.occupancy, ADR-025).
      popupRef.current?.close()
      popupRef.current = null
    }
  }, [])

  const openPopup = useCallback(
    ({ clientId, nonce, lang }: { clientId: string; nonce: string; lang?: string }): boolean => {
      // The named window is reused across clicks — a second tap
      // navigates the same popup rather than stacking windows.
      const popup = openTelegramAuthPopup({ clientId, nonce, lang })
      if (!popup) return false
      popupRef.current = popup
      if (pollerRef.current !== null) clearInterval(pollerRef.current)
      pollerRef.current = window.setInterval(() => {
        const w = popupRef.current
        if (!w || w.closed) {
          if (pollerRef.current !== null) {
            clearInterval(pollerRef.current)
            pollerRef.current = null
          }
          // popupRef stays: a queued result must still pass the
          // listener's source check.
          onResultRef.current({ error: 'popup_closed' })
        }
      }, POPUP_CLOSE_POLL_MS)
      return true
    },
    [],
  )

  return { openPopup }
}
