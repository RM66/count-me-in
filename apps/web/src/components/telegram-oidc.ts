/**
 * Telegram OIDC login plumbing (ADR-026).
 *
 * Two delivery paths: inside the Telegram WebView the telegram-login.js
 * lib drives `/inapp` (see telegram-inapp.ts); everywhere else we open
 * `/auth?response_type=post_message&…&origin=…` ourselves and listen
 * for `auth_result` — the stock lib's popup branch omits `origin`.
 *
 * The nonce is a hash of a page-local verifier (PKCE-style): the API
 * re-checks `sha256(nonceVerifier) == claims.nonce`.
 */

export const OIDC_ORIGIN = 'https://oauth.telegram.org'

/** Bot DM permission — replaces the widget's `request_access=write`. */
const TELEGRAM_AUTH_SCOPE = 'openid profile telegram:bot_access'
/** The lib maps its `write` scope shorthand onto telegram:bot_access. */
export const TELEGRAM_LIB_SCOPE = ['profile', 'write'] as const

export type TelegramAuthResult = {
  id_token?: string
  error?: string
}

/** The verified pair the page sends to the API: token + its verifier. */
export type TelegramProof = { idToken: string; nonceVerifier: string }

/** Inside Telegram's own browser (iOS) — the lib's /inapp branch target. */
export function isTelegramWebView(): boolean {
  return typeof window !== 'undefined' && window.TelegramWebviewProxy !== undefined
}

/** A usable Client ID is the numeric bot id — anything else renders `notConfigured`. */
export function isTelegramClientId(value: string): boolean {
  return /^\d+$/.test(value)
}

export type NoncePair = { verifier: string; nonce: string }

function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** One verifier pair: 32 random bytes, nonce = b64url(sha256(verifier)). */
export async function newNoncePair(): Promise<NoncePair> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, nonce: b64url(new Uint8Array(digest)) }
}

/**
 * The token's `nonce` claim — ONLY a map lookup key pairing a result
 * with its verifier. Untrusted: the server re-verifies it.
 */
export function idTokenNonce(idToken: string): string | null {
  try {
    const payload = idToken.split('.')[1]
    if (!payload) return null
    let b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    b64 += '='.repeat((4 - (b64.length % 4)) % 4)
    const claims: unknown = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))),
    )
    const nonce = (claims as { nonce?: unknown }).nonce
    return typeof nonce === 'string' ? nonce : null
  } catch {
    return null
  }
}

/**
 * The manual popup — same post_message flow the stock lib runs, plus
 * the `origin` param it omits. Synchronous: window.open must happen in
 * the click handler or Safari/iOS blocks it. Centered over the current
 * window; the browser clamps on-screen itself.
 */
export function openTelegramAuthPopup({
  clientId,
  nonce,
  lang,
}: {
  clientId: string
  nonce: string
  lang?: string
}): Window | null {
  const params = new URLSearchParams({
    response_type: 'post_message',
    client_id: clientId,
    redirect_uri: window.location.origin + window.location.pathname,
    origin: window.location.origin,
    scope: TELEGRAM_AUTH_SCOPE,
    nonce,
  })
  if (lang) params.set('lang', lang)
  const width = 550
  const height = 650
  const left = window.screenX + (window.outerWidth - width) / 2
  const top = window.screenY + (window.outerHeight - height) / 2
  return window.open(
    `${OIDC_ORIGIN}/auth?${params.toString()}`,
    'telegram_oidc_login',
    `width=${width},height=${height},left=${left},top=${top},status=0,location=0,menubar=0,toolbar=0`,
  )
}
