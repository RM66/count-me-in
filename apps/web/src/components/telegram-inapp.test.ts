/**
 * telegram-inapp.ts — the script loader's module-level promise caching:
 * a failed load must clear it so a retry really retries (the hook's
 * retry button relies on this), while a resolved load short-circuits
 * once Telegram.Login exists.
 *
 * happy-dom refuses to load external scripts — it fails the append with
 * an error, which doubles here as the "adblock cut telegram.org" path.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  __resetOauthForTest,
  inAppRequestCount,
  loadTelegramLoginScript,
  observeOauthSupported,
  telegramOauthSupported,
  whenOauthSupported,
} from './telegram-inapp'

function scriptCount(): number {
  return [...document.head.querySelectorAll('script')].filter((s) =>
    s.src.includes('telegram-login.js'),
  ).length
}

afterEach(() => {
  for (const s of document.head.querySelectorAll('script')) {
    if (s.src.includes('telegram-login.js')) s.remove()
  }
  __resetOauthForTest()
  delete window.Telegram
  delete window.TelegramWebviewProxy
  vi.restoreAllMocks()
})

describe('loadTelegramLoginScript', () => {
  it('clears the cached promise and the dead script on error so a retry retries', async () => {
    const appended = vi.spyOn(document.head, 'appendChild')
    await expect(loadTelegramLoginScript()).rejects.toThrow()
    // Retry after the failure — a second <script> must be appended;
    // a still-cached rejected promise would mean retry is dead code.
    await expect(loadTelegramLoginScript()).rejects.toThrow()
    expect(appended).toHaveBeenCalledTimes(2)
    // Each failed attempt removed its own <script> — nothing stale in head.
    expect(scriptCount()).toBe(0)
  })

  it('short-circuits when Telegram.Login is already present', async () => {
    window.Telegram = { Login: { auth: () => {}, close: () => {} } }
    await expect(loadTelegramLoginScript()).resolves.toBeUndefined()
    expect(scriptCount()).toBe(0)
  })
})

describe('oauth_supported handshake', () => {
  it('captures the one-shot event at observe-time and resolves waiters', async () => {
    const receiveEvent = vi.fn()
    window.Telegram = { WebView: { receiveEvent } }
    const waiter = whenOauthSupported()
    observeOauthSupported()
    expect(telegramOauthSupported()).toBe(false)

    // Firing through the wrapped receiveEvent sets the flag and still
    // reaches the lib's own handler.
    window.Telegram!.WebView!.receiveEvent!('oauth_supported')
    expect(telegramOauthSupported()).toBe(true)
    await expect(waiter).resolves.toBeUndefined()
    expect(receiveEvent).toHaveBeenCalledWith('oauth_supported', undefined)
    // A waiter after the fact resolves immediately.
    await expect(whenOauthSupported()).resolves.toBeUndefined()
  })

  it('also captures the event delivered through TelegramGameProxy', () => {
    // The lib installs the same receiveEvent on both objects; on-device
    // the iOS WebView invokes one of them and which one is not
    // observable, so both are wrapped (verified on device 2026-10-25).
    const receiveEvent = vi.fn()
    window.Telegram = {
      WebView: { receiveEvent },
      TelegramGameProxy: { receiveEvent },
    }
    observeOauthSupported()
    window.Telegram!.TelegramGameProxy!.receiveEvent!('oauth_supported')
    expect(telegramOauthSupported()).toBe(true)
    expect(receiveEvent).toHaveBeenCalledTimes(1)
  })

  it('counts url-bearing oauth_request sends, not the {} handshake', () => {
    const postEvent = vi.fn()
    window.TelegramWebviewProxy = { postEvent }
    observeOauthSupported()

    // The lib's initProxy handshake — no url, not an auth attempt.
    window.TelegramWebviewProxy.postEvent('oauth_request', '{}')
    expect(inAppRequestCount()).toBe(0)

    window.TelegramWebviewProxy.postEvent('oauth_request', '{"url":"tg://auth"}')
    expect(inAppRequestCount()).toBe(1)
    // The original handler still receives every call.
    expect(postEvent).toHaveBeenCalledTimes(2)
  })

  it('loading the script installs the observer (short-circuit path)', async () => {
    const receiveEvent = vi.fn()
    window.Telegram = {
      Login: { auth: () => {}, close: () => {} },
      WebView: { receiveEvent },
    }
    await loadTelegramLoginScript()
    window.Telegram!.WebView!.receiveEvent!('oauth_supported')
    expect(telegramOauthSupported()).toBe(true)
  })
})
