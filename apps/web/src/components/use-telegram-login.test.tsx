/**
 * useTelegramLogin + TelegramLoginButton — the OIDC client flow
 * (ADR-026): verifier pairs keyed by nonce, the manual popup path,
 * the in-app lib path, unmount invalidation, and the three modes'
 * ticket branching.
 */

import { createHash } from 'node:crypto'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetOauthForTest, loadTelegramLoginScript } from '@/components/telegram-inapp'
import { IntlTestProvider } from '@/i18n/test-provider'
import { TelegramLoginButton } from './telegram-login-button'

const mocks = vi.hoisted(() => ({
  load: vi.fn<() => Promise<void>>(),
  post: vi.fn(),
  signIn: vi.fn(),
}))

vi.mock('@/components/telegram-inapp', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/components/telegram-inapp')>()
  return {
    ...mod,
    // The real loader installs the oauth_supported observer once the
    // script resolves — the mock must too, or the one-shot event never
    // reaches module state and whenOauthSupported hangs.
    loadTelegramLoginScript: async () => {
      await mocks.load()
      mod.observeOauthSupported()
    },
  }
})
vi.mock('@/api-client/client', () => ({ post: (...args: unknown[]) => mocks.post(...args) }))
vi.mock('next-auth/react', () => ({ signIn: (...args: unknown[]) => mocks.signIn(...args) }))

const OIDC_ORIGIN = 'https://oauth.telegram.org'
const CLIENT_ID = '1234567890'

function b64urlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function fakeJwt(claims: Record<string, unknown>): string {
  return `${b64urlJson({ alg: 'RS256', kid: 'k' })}.${b64urlJson(claims)}.sig`
}

function sha256b64url(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('base64url')
}

type FakePopup = { closed: boolean; close: () => void }

function installOpenStub() {
  const calls: { url: string; popup: FakePopup }[] = []
  // The named window is reused across calls — one popup object for the
  // whole test, matching real `window.open(url, 'telegram_oidc_login')`.
  const sharedPopup: FakePopup = {
    closed: false,
    close() {
      this.closed = true
    },
  }
  vi.stubGlobal('open', (url: string | URL) => {
    calls.push({ url: String(url), popup: sharedPopup })
    return sharedPopup
  })
  return calls
}

function nonceFromUrl(url: string): string {
  const nonce = new URL(url).searchParams.get('nonce')
  if (!nonce) throw new Error(`no nonce in ${url}`)
  return nonce
}

/**
 * crypto.subtle.digest resolves off-microtask under load, so `await act()`
 * is not a barrier for the precomputed "next pair" — a flaky gate. A
 * synchronous real SHA-256 keeps the test deterministic while preserving
 * the nonce = sha256(verifier) relation other assertions rely on.
 */
function mockSyncDigest() {
  vi.spyOn(window.crypto.subtle, 'digest').mockImplementation(async (_alg, data) => {
    const digest = createHash('sha256')
      .update(new Uint8Array(data as ArrayBuffer))
      .digest()
    return new Uint8Array(digest).buffer as ArrayBuffer
  })
}

function deliverAuthResult(popup: FakePopup, result: string | { error: string }) {
  fireEvent(
    window,
    new MessageEvent('message', {
      data: JSON.stringify({
        event: 'auth_result',
        ...(typeof result === 'string' ? { result } : { error: result.error }),
      }),
      origin: OIDC_ORIGIN,
      source: popup as unknown as Window,
    }),
  )
}

function renderButton(props: Partial<Parameters<typeof TelegramLoginButton>[0]> = {}) {
  const onError = vi.fn()
  const utils = render(
    <IntlTestProvider>
      <TelegramLoginButton
        {...(props as Parameters<typeof TelegramLoginButton>[0])}
        clientId={props.clientId ?? CLIENT_ID}
        onError={onError}
      />
    </IntlTestProvider>,
  )
  return { onError, ...utils }
}

async function readyButton() {
  const btn = await screen.findByRole('button')
  await waitFor(() => expect(btn).toBeEnabled())
  return btn
}

beforeEach(async () => {
  // happy-dom is not a secure context — the flow requires one for
  // crypto.subtle; stub it so the hook reaches the pair path.
  vi.stubGlobal('isSecureContext', true)
  // happy-dom may lack subtle — fall back to Node's webcrypto.
  if (!window.crypto?.subtle) {
    const { webcrypto } = await import('node:crypto')
    Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true })
  }
  mocks.load.mockReset().mockResolvedValue(undefined)
  mocks.post.mockReset()
  mocks.signIn.mockReset()
  delete window.TelegramWebviewProxy
  delete window.Telegram
  __resetOauthForTest()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('manual popup path', () => {
  it('opens the /auth popup synchronously inside the click and pairs by nonce', async () => {
    const onGuestTicket = vi.fn()
    mocks.post.mockResolvedValue({
      ticket: 't1',
      messenger: 'telegram',
      messengerId: '1',
      displayName: 'G',
    })
    const calls = installOpenStub()
    renderButton({ mode: 'guest', onGuestTicket })

    const btn = await readyButton()
    fireEvent.click(btn)
    // window.open already ran — nothing was awaited before it
    // (Safari/iOS popup blockers would kill a deferred open).
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url.startsWith(`${OIDC_ORIGIN}/auth?`)).toBe(true)
    expect(calls[0]!.url).toContain(`client_id=${CLIENT_ID}`)
    const nonce = nonceFromUrl(calls[0]!.url)

    deliverAuthResult(calls[0]!.popup, fakeJwt({ nonce }))

    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1))
    const [url, body] = mocks.post.mock.calls[0]!
    expect(url).toBe('/api/auth/telegram-guest')
    expect(body.idToken).toContain('.')
    // The verifier POSTed is the preimage of the nonce the popup got.
    expect(sha256b64url(body.nonceVerifier)).toBe(nonce)
    await waitFor(() => expect(onGuestTicket).toHaveBeenCalledTimes(1))
  })

  it('mints a fresh pair per attempt', async () => {
    mockSyncDigest()
    const calls = installOpenStub()
    renderButton({ mode: 'guest' })
    const btn = await readyButton()
    fireEvent.click(btn)
    // The next pair is precomputed after the auth call — let it land so
    // the second attempt mints rather than reusing the same nonce.
    await act(async () => {})
    fireEvent.click(btn)
    expect(calls).toHaveLength(2)
    expect(nonceFromUrl(calls[0]!.url)).not.toBe(nonceFromUrl(calls[1]!.url))
  })

  it('pairs a late result by its nonce claim, not by click order', async () => {
    mockSyncDigest()
    mocks.post.mockResolvedValue({ ticket: 't', messenger: 'telegram', messengerId: '1' })
    const calls = installOpenStub()
    renderButton({ mode: 'guest' })
    const btn = await readyButton()
    fireEvent.click(btn)
    const first = nonceFromUrl(calls[0]!.url)
    await act(async () => {})
    fireEvent.click(btn)
    nonceFromUrl(calls[1]!.url)
    // The first click's token arrives last — the verifier that goes out
    // must still be the one minted for ITS nonce.
    deliverAuthResult(calls[0]!.popup, fakeJwt({ nonce: first }))
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1))
    expect(sha256b64url(mocks.post.mock.calls[0]![1].nonceVerifier)).toBe(first)
  })

  it('drops a result carrying a nonce this page never issued', async () => {
    const calls = installOpenStub()
    renderButton({ mode: 'guest' })
    await readyButton()
    fireEvent.click(screen.getByRole('button'))
    deliverAuthResult(calls[0]!.popup, fakeJwt({ nonce: 'foreign-nonce' }))
    await act(async () => {})
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('consumes each verifier once — a duplicate delivery is dropped', async () => {
    mocks.post.mockResolvedValue({ ticket: 't', messenger: 'telegram', messengerId: '1' })
    const calls = installOpenStub()
    renderButton({ mode: 'guest' })
    const btn = await readyButton()
    fireEvent.click(btn)
    const nonce = nonceFromUrl(calls[0]!.url)
    const token = fakeJwt({ nonce })
    deliverAuthResult(calls[0]!.popup, token)
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1))
    deliverAuthResult(calls[0]!.popup, token)
    await act(async () => {})
    expect(mocks.post).toHaveBeenCalledTimes(1)
  })

  it('disables the button while the ticket exchange is in flight', async () => {
    let resolvePost: (v: unknown) => void = () => {}
    mocks.post.mockImplementation(
      () =>
        new Promise((r) => {
          resolvePost = r
        }),
    )
    const calls = installOpenStub()
    renderButton({ mode: 'guest' })
    const btn = await readyButton()
    fireEvent.click(btn)
    const nonce = nonceFromUrl(calls[0]!.url)
    deliverAuthResult(calls[0]!.popup, fakeJwt({ nonce }))
    // The POST is still in flight — a second tap must not mint another token.
    await waitFor(() => expect(btn).toBeDisabled())
    resolvePost({ ticket: 't', messenger: 'telegram', messengerId: '1' })
    await waitFor(() => expect(btn).toBeEnabled())
  })

  it('popup_closed is a silent cancel — onError is not called', async () => {
    const calls = installOpenStub()
    const { onError } = renderButton({ mode: 'guest' })
    const btn = await readyButton()
    fireEvent.click(btn)
    deliverAuthResult(calls[0]!.popup, { error: 'popup_closed' })
    await act(async () => {})
    expect(onError).not.toHaveBeenCalled()
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('a real popup close fires popup_closed — silent cancel', async () => {
    const calls = installOpenStub()
    const { onError } = renderButton({ mode: 'guest' })
    const btn = await readyButton()
    fireEvent.click(btn)
    calls[0]!.popup.closed = true
    // The 200ms close poller notices and reports popup_closed.
    await waitFor(() => expect(calls[0]!.popup.closed).toBe(true), { timeout: 1000 })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300))
    })
    expect(onError).not.toHaveBeenCalled()
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('a blocked window.open surfaces the allow-pop-ups hint and stays retryable', async () => {
    vi.stubGlobal('open', () => null)
    const { onError } = renderButton({ mode: 'guest' })
    const btn = await readyButton()
    fireEvent.click(btn)
    // Inline guidance, not a dead click — and not an onError failure.
    expect(await screen.findByText(/pop-ups/i)).toBeInTheDocument()
    expect(onError).not.toHaveBeenCalled()
    expect(btn).toBeEnabled()

    // The next attempt clears the hint and opens for real.
    const calls = installOpenStub()
    fireEvent.click(btn)
    expect(calls).toHaveLength(1)
    await waitFor(() => expect(screen.queryByText(/pop-ups/i)).toBeNull())
  })

  it('result errors surface a localized inline hint, not a raw onError code', async () => {
    const calls = installOpenStub()
    const { onError } = renderButton({ mode: 'guest' })
    const btn = await readyButton()
    fireEvent.click(btn)
    deliverAuthResult(calls[0]!.popup, { error: 'access_denied' })
    // Technical codes ("access_denied", "missing id_token") would leak
    // English through errorMessage — the hint is localized instead and
    // the code stays in console.error.
    expect(await screen.findByText(/verify you with Telegram/i)).toBeInTheDocument()
    expect(onError).not.toHaveBeenCalled()

    // The next attempt clears the hint.
    fireEvent.click(btn)
    await waitFor(() => expect(screen.queryByText(/verify you with Telegram/i)).toBeNull())
  })

  it('drops a result that arrives after unmount and closes the popup', async () => {
    const close = vi.fn()
    window.Telegram = { Login: { auth: vi.fn(), close } }
    const calls = installOpenStub()
    mocks.post.mockResolvedValue({ ticket: 't', messenger: 'telegram', messengerId: '1' })
    const { unmount } = renderButton({ mode: 'guest' })
    const btn = await readyButton()
    fireEvent.click(btn)
    const nonce = nonceFromUrl(calls[0]!.url)
    unmount()
    expect(close).toHaveBeenCalled()
    deliverAuthResult(calls[0]!.popup, fakeJwt({ nonce }))
    await act(async () => {})
    expect(mocks.post).not.toHaveBeenCalled()
  })
})

describe('in-app lib path', () => {
  function installInApp() {
    const auth = vi.fn()
    const close = vi.fn()
    window.TelegramWebviewProxy = { postEvent: vi.fn() }
    window.Telegram = {
      Login: { auth, close },
      WebView: { receiveEvent: vi.fn() },
    }
    return { auth, close }
  }

  it('keeps the button disabled until oauth_supported, then uses the lib', async () => {
    const { auth } = installInApp()
    mocks.post.mockResolvedValue({ ticket: 't', messenger: 'telegram', messengerId: '1' })
    renderButton({ mode: 'guest' })
    const btn = await screen.findByRole('button')
    // Still gated — neither oauth_supported nor the grace has fired yet.
    expect(btn).toBeDisabled()

    // Fire until the hook's wrapper is installed and observes the event.
    await waitFor(() => {
      window.Telegram!.WebView!.receiveEvent!('oauth_supported')
      expect(btn).toBeEnabled()
    })

    fireEvent.click(btn)
    expect(auth).toHaveBeenCalledTimes(1)
    const [opts, cb] = auth.mock.calls[0]!
    expect(opts.client_id).toBe(CLIENT_ID)
    expect(opts.scope).toEqual(['profile', 'write'])
    expect(opts.lang).toBe('en')
    const nonce = opts.nonce as string

    await act(async () => {
      cb({ id_token: fakeJwt({ nonce }) })
    })
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1))
    expect(sha256b64url(mocks.post.mock.calls[0]![1].nonceVerifier)).toBe(nonce)
  })

  it('enables after the grace window and falls back to the manual popup', async () => {
    installInApp()
    const calls = installOpenStub()
    renderButton({ mode: 'guest' })
    const btn = await screen.findByRole('button')
    await waitFor(() => expect(btn).toBeEnabled(), { timeout: 3000 })
    fireEvent.click(btn)
    // oauth_supported never arrived → not the lib's (broken-outside-
    // inapp) popup branch but our own origin-carrying /auth URL.
    expect(window.Telegram!.Login!.auth).not.toHaveBeenCalled()
    expect(calls).toHaveLength(1)
  }, 10000)

  it('uses the lib path when oauth_supported fired before mount (warm-up load)', async () => {
    const { auth } = installInApp()
    // The booking dialog's warm-up resolves the load first; the module
    // observer (installed inside loadTelegramLoginScript) must capture
    // the one-shot event even though no hook is mounted yet.
    await loadTelegramLoginScript()
    window.Telegram!.WebView!.receiveEvent!('oauth_supported')
    renderButton({ mode: 'guest' })
    const btn = await readyButton()
    fireEvent.click(btn)
    expect(auth).toHaveBeenCalledTimes(1)
  })

  it('script-load failure keeps the manual popup and offers retry', async () => {
    const { auth } = installInApp()
    const calls = installOpenStub()
    mocks.load.mockRejectedValueOnce(new Error('network'))
    renderButton({ mode: 'guest' })

    // Not blocked: the manual popup needs no lib, so the button stays
    // enabled and the click opens /auth itself.
    const btn = await screen.findByRole('button', { name: 'Confirm with Telegram' })
    await waitFor(() => expect(btn).toBeEnabled())
    fireEvent.click(btn)
    expect(calls).toHaveLength(1)
    expect(auth).not.toHaveBeenCalled()

    // Retry reloads the lib; once it resolves the hint goes away and
    // the in-app handshake runs — the next click uses the lib path.
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
      window.Telegram!.WebView!.receiveEvent!('oauth_supported')
    })
    fireEvent.click(btn)
    expect(auth).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(1)
  })

  it('a dead in-app attempt routes the next click to the manual popup', async () => {
    const { auth } = installInApp()
    const calls = installOpenStub()
    renderButton({ mode: 'guest' })
    const btn = await screen.findByRole('button')
    await waitFor(() => {
      window.Telegram!.WebView!.receiveEvent!('oauth_supported')
      expect(btn).toBeEnabled()
    })

    fireEvent.click(btn)
    expect(auth).toHaveBeenCalledTimes(1)
    // The lib's /inapp fetch failed: inAppRequestPending stays set and
    // no oauth_request sendEvent ever reaches the proxy — the watchdog
    // marks the lib path dead instead of leaving every tap a no-op.
    expect(await screen.findByText(/didn't open/i, {}, { timeout: 6000 })).toBeInTheDocument()

    fireEvent.click(btn)
    expect(auth).toHaveBeenCalledTimes(1) // no more dead lib calls
    expect(calls).toHaveLength(1) // the manual popup took over
    expect(calls[0]!.url.startsWith(`${OIDC_ORIGIN}/auth?`)).toBe(true)
  }, 15000)

  it('an observed oauth_request send keeps the lib path for the next click', async () => {
    const { auth } = installInApp()
    renderButton({ mode: 'guest' })
    const btn = await screen.findByRole('button')
    await waitFor(() => {
      window.Telegram!.WebView!.receiveEvent!('oauth_supported')
      expect(btn).toBeEnabled()
    })
    // Simulate the lib reaching sendEvent — the sheet was summoned.
    auth.mockImplementation(() => {
      window.TelegramWebviewProxy!.postEvent('oauth_request', JSON.stringify({ url: 'tg://x' }))
    })

    fireEvent.click(btn)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 4500))
    })
    expect(screen.queryByText(/didn't open/i)).toBeNull()
    fireEvent.click(btn)
    expect(auth).toHaveBeenCalledTimes(2)
  }, 15000)
})

describe('modes', () => {
  async function deliverClick(): Promise<string> {
    const calls = installOpenStub()
    const btn = await readyButton()
    fireEvent.click(btn)
    const nonce = nonceFromUrl(calls[0]!.url)
    deliverAuthResult(calls[0]!.popup, fakeJwt({ nonce }))
    return nonce
  }

  it('signup mode: issues onTicketIssued with organizerExists', async () => {
    mocks.post.mockResolvedValue({ ticket: 'tk', organizerExists: true })
    const onTicketIssued = vi.fn()
    renderButton({ mode: 'signup', onTicketIssued })
    await deliverClick()
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1))
    expect(mocks.post.mock.calls[0]![0]).toBe('/api/auth/telegram-signup')
    await waitFor(() => expect(onTicketIssued).toHaveBeenCalledWith('tk', true))
  })

  it('login mode: signs in with the ticket when the organizer exists', async () => {
    mocks.post.mockResolvedValue({ ticket: 'tk', organizerExists: true })
    mocks.signIn.mockResolvedValue({ ok: true })
    renderButton({ mode: 'login' })
    await deliverClick()
    await waitFor(() =>
      expect(mocks.signIn).toHaveBeenCalledWith('telegram', {
        ticket: 'tk',
        redirect: false,
      }),
    )
  })

  it('login mode: reports a failed sign-in instead of navigating', async () => {
    mocks.post.mockResolvedValue({ ticket: 'tk', organizerExists: true })
    // The real next-auth v5 result shape on a failed authorize: the
    // callback answers 200 {url:"...?error=..."}, so `ok` is true while
    // `error` carries the failure — checking `ok` alone masks it.
    mocks.signIn.mockResolvedValue({ ok: true, error: 'CredentialsSignin', url: null })
    const { onError } = renderButton({ mode: 'login' })
    await deliverClick()
    await waitFor(() => expect(onError).toHaveBeenCalledWith('CredentialsSignin'))
  })

  it('login mode: calls onSignupRequired when no organizer exists', async () => {
    mocks.post.mockResolvedValue({ ticket: 'tk', organizerExists: false })
    const onSignupRequired = vi.fn()
    renderButton({ mode: 'login', onSignupRequired })
    await deliverClick()
    await waitFor(() => expect(onSignupRequired).toHaveBeenCalledWith('tk'))
    expect(mocks.signIn).not.toHaveBeenCalled()
  })

  it('guest mode: posts to telegram-guest and returns the ticket', async () => {
    mocks.post.mockResolvedValue({
      ticket: 'gt',
      messenger: 'telegram',
      messengerId: '7',
      displayName: 'G',
    })
    const onGuestTicket = vi.fn()
    renderButton({ mode: 'guest', onGuestTicket })
    await deliverClick()
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1))
    expect(mocks.post.mock.calls[0]![0]).toBe('/api/auth/telegram-guest')
    await waitFor(() => expect(onGuestTicket).toHaveBeenCalledTimes(1))
  })
})

describe('statuses', () => {
  it('non-numeric clientId renders the configuration error', async () => {
    renderButton({ clientId: 'countmein_bot' })
    expect(await screen.findByText(/not configured/i)).toBeInTheDocument()
  })

  it('insecure context renders the HTTPS-required message', async () => {
    vi.stubGlobal('isSecureContext', false)
    renderButton()
    expect(await screen.findByText(/secure connection/i)).toBeInTheDocument()
  })
})
