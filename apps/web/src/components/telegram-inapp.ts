/**
 * In-app (Telegram WebView) side of the OIDC login (ADR-026).
 *
 * Inside `window.TelegramWebviewProxy` the telegram-login.js lib drives
 * `/inapp` — the only upstream branch that sends `origin`. Loaded on
 * demand (its `data-*` auto-init runs through eval).
 *
 * On load the lib posts `oauth_request`; the WebView answers with a
 * one-shot `oauth_supported` via `receiveEvent` on `Telegram.WebView`
 * or `Telegram.TelegramGameProxy` — the observer wraps both so a
 * warm-up load cannot consume the event before the button mounts.
 */

import type { TelegramAuthResult } from './telegram-oidc'

const TELEGRAM_LOGIN_SCRIPT_URL = 'https://telegram.org/js/telegram-login.js'

type LibAuthOpts = { client_id: string; scope: readonly string[]; lang?: string; nonce?: string }

declare global {
  interface Window {
    Telegram?: {
      Login?: {
        auth: (opts: LibAuthOpts, cb: (result: TelegramAuthResult) => void) => void
        close: () => void
      }
      /** lib-installed targets; which one the WebView calls is not observable. */
      WebView?: ReceiveEventTarget
      TelegramGameProxy?: ReceiveEventTarget
    }
    TelegramWebviewProxy?: { postEvent: (eventType: string, eventData: string) => void }
  }
}

type ReceiveEventTarget = { receiveEvent?: (eventType: string, eventData?: unknown) => void }

let loadPromise: Promise<void> | null = null

let oauthSupportedFlag = false
let oauthResolve: (() => void) | undefined
let oauthPromise: Promise<void> | undefined
const observed = new Set<ReceiveEventTarget>()

// Url-bearing `oauth_request` sends — the only checkpoint between
// auth() and the native sheet, so it detects the upstream dead flag
// (inAppRequestPending never clears after a failed /inapp fetch).
let oauthRequestCount = 0
let observedProxy: { postEvent: (eventType: string, eventData: string) => void } | undefined

/**
 * Wrap `receiveEvent` on both lib targets + `postEvent` on the proxy so
 * lib lifecycle events land in module state. Wraps, never replaces.
 */
export function observeOauthSupported(): void {
  const telegram = window.Telegram
  for (const target of [telegram?.WebView, telegram?.TelegramGameProxy]) {
    if (!target?.receiveEvent || observed.has(target)) continue
    const orig = target.receiveEvent
    target.receiveEvent = (eventType: string, eventData?: unknown) => {
      if (eventType === 'oauth_supported') {
        oauthSupportedFlag = true
        oauthResolve?.()
      }
      return orig(eventType, eventData)
    }
    observed.add(target)
  }
  const proxy = window.TelegramWebviewProxy
  if (proxy && proxy !== observedProxy) {
    const orig = proxy.postEvent
    proxy.postEvent = (eventType, eventData) => {
      if (eventType === 'oauth_request' && hasRequestUrl(eventData)) oauthRequestCount += 1
      return orig.call(proxy, eventType, eventData)
    }
    observedProxy = proxy
  }
}

// eventData is JSON — the handshake sends `{}`, the auth sheet `{url}`.
function hasRequestUrl(eventData: string): boolean {
  try {
    return !!(JSON.parse(eventData) as { url?: unknown }).url
  } catch {
    return false
  }
}

export function inAppRequestCount(): number {
  return oauthRequestCount
}

/** Whether the lib reported `oauth_supported` — the click's lib-vs-popup switch. */
export function telegramOauthSupported(): boolean {
  return oauthSupportedFlag
}

/** Resolves once `oauth_supported` has arrived (immediately if it already did). */
export function whenOauthSupported(): Promise<void> {
  if (oauthSupportedFlag) return Promise.resolve()
  oauthPromise ??= new Promise<void>((resolve) => (oauthResolve = resolve))
  return oauthPromise
}

/** Test-only: clear the handshake so each test owns a fresh one. */
export function __resetOauthForTest(): void {
  oauthSupportedFlag = false
  oauthResolve = undefined
  oauthPromise = undefined
  observed.clear()
  oauthRequestCount = 0
  observedProxy = undefined
}

/** Idempotent loader: a failure clears promise + dead script so retry retries. */
export function loadTelegramLoginScript(): Promise<void> {
  if (window.Telegram?.Login) {
    observeOauthSupported()
    return Promise.resolve()
  }
  if (!loadPromise) {
    loadPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = TELEGRAM_LOGIN_SCRIPT_URL
      script.async = true
      script.onload = () => {
        if (window.Telegram?.Login) {
          resolve()
        } else {
          script.remove()
          reject(new Error('telegram-login.js loaded without Telegram.Login'))
        }
      }
      script.onerror = () => {
        script.remove()
        reject(new Error('telegram-login.js failed to load'))
      }
      document.head.appendChild(script)
    })
    void loadPromise.then(
      // A resolved load is the earliest point receiveEvent exists.
      () => observeOauthSupported(),
      () => {
        loadPromise = null
      },
    )
  }
  return loadPromise
}
