'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { inAppRequestCount, telegramOauthSupported } from './telegram-inapp'
import {
  idTokenNonce,
  isTelegramClientId,
  isTelegramWebView,
  TELEGRAM_LIB_SCOPE,
  type TelegramAuthResult,
  type TelegramProof,
} from './telegram-oidc'
import { useInAppHandshake } from './use-inapp-handshake'
import { useNoncePairs } from './use-nonce-pairs'
import { useTelegramPopup } from './use-telegram-popup'

export type TelegramLoginStatus = 'loading' | 'ready' | 'unavailable' | 'config'

/** How long an in-app auth() gets to reach sendEvent before being declared dead. */
const INAPP_REQUEST_TIMEOUT_MS = 4000

/**
 * The OIDC flow state machine behind TelegramLoginButton (ADR-026).
 *
 * `onClick` is synchronous (Safari/iOS blocks awaited popups), so pairs
 * are precomputed (useNoncePairs). A result is paired by the nonce
 * inside its token, never by click order: a repeat in-app tap can
 * deliver a token minted for an older nonce.
 *
 * `useNoncePairs` owns the verifier map, `useTelegramPopup` the manual
 * popup, `useInAppHandshake` the WebView lib — this file orchestrates.
 */
export function useTelegramLogin({
  clientId,
  lang,
  onResult,
}: {
  clientId: string
  lang?: string
  onResult: (proof: TelegramProof) => void
}): {
  status: TelegramLoginStatus
  loadFailed: boolean
  popupBlocked: boolean
  authFailed: boolean
  inAppFailed: boolean
  retry: () => void
  onClick: () => void
} {
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult

  // Measured on mount, not render: SSR has no window and must emit
  // `loading`, so `null` = "not measured" maps to `loading`.
  const [secure, setSecure] = useState<boolean | null>(null)
  const configured = isTelegramClientId(clientId)
  const inApp = isTelegramWebView() // already typeof-window-guarded

  const [popupBlocked, setPopupBlocked] = useState(false)
  // A result-side auth failure (error field, missing/malformed token) —
  // shown inline, localized; the technical code only goes to console.
  const [authFailed, setAuthFailed] = useState(false)
  // Upstream: a failed /inapp request leaves `inAppRequestPending` set
  // forever — later auth() calls silently no-op and close() doesn't
  // reset it. Once detected, the lib path is dead for this page's life
  // and clicks route to the manual popup.
  const [inAppFailed, setInAppFailed] = useState(false)
  // One gate for every eager piece of the flow: nothing mints, loads,
  // or observes until the page is secure and the client id parses.
  const active = secure === true && configured
  const { pairReady, takePair, consumeVerifier, dropPair } = useNoncePairs(active)

  useEffect(() => {
    setSecure(window.isSecureContext && !!crypto.subtle)
    return () => {
      // A lib callback completed after unmount must not fire into a
      // torn-down flow.
      window.Telegram?.Login?.close()
    }
  }, [])

  const handleResult = useCallback(
    (result: TelegramAuthResult) => {
      // A cancel, not a failure — also absorbs the stale popup_closed a
      // superseded popup attempt may still fire.
      if (result.error === 'popup_closed') return
      if (result.error || !result.id_token) {
        console.error('[useTelegramLogin] auth result error:', result.error ?? 'missing id_token')
        setAuthFailed(true)
        return
      }
      const nonce = idTokenNonce(result.id_token)
      if (nonce === null) {
        console.error('[useTelegramLogin] malformed id_token — no nonce claim')
        setAuthFailed(true)
        return
      }
      const verifier = consumeVerifier(nonce)
      // Unmounted (map cleared) or a nonce this page never issued — ignore.
      if (verifier === undefined) return
      onResultRef.current({ idToken: result.id_token, nonceVerifier: verifier })
    },
    [consumeVerifier],
  )

  const { openPopup } = useTelegramPopup({ onResult: handleResult })
  const { inAppReady, loadFailed, retry } = useInAppHandshake({ inApp, active })

  const onClick = useCallback(() => {
    setPopupBlocked(false)
    setAuthFailed(false)
    const pair = takePair()
    if (!pair) return

    const lib = window.Telegram?.Login
    if (!inAppFailed && telegramOauthSupported() && lib) {
      // In-app: the lib's TelegramWebviewProxy branch (sends origin).
      const before = inAppRequestCount()
      lib.auth(
        { client_id: clientId, scope: TELEGRAM_LIB_SCOPE, lang, nonce: pair.nonce },
        handleResult,
      )
      // The sendEvent send is the only observable checkpoint: if it
      // never fires, the lib is stuck on a dead inAppRequestPending.
      window.setTimeout(() => {
        if (inAppRequestCount() === before) setInAppFailed(true)
      }, INAPP_REQUEST_TIMEOUT_MS)
    } else if (!openPopup({ clientId, nonce: pair.nonce, lang })) {
      // window.open refused: no result can arrive for this nonce —
      // drop its pair and surface the "allow pop-ups" hint.
      dropPair(pair.nonce)
      setPopupBlocked(true)
    }
  }, [clientId, lang, handleResult, openPopup, takePair, dropPair, inAppFailed])

  const status: TelegramLoginStatus = !configured
    ? 'config'
    : secure === false
      ? 'unavailable'
      : secure === true && pairReady && inAppReady
        ? 'ready'
        : 'loading'

  return { status, loadFailed, popupBlocked, authFailed, inAppFailed, retry, onClick }
}
