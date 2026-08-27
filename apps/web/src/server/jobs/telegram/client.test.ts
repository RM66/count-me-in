import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { sendMessage, TelegramTransientError, TelegramUnreachableError } from './client'

// ── Helpers ──────────────────────────────────────────────────────────────────

const BOT_TOKEN = 'test-bot-token'
const CHAT_ID = '123456'

function telegramResponse(ok: boolean, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const input = {
  chatId: CHAT_ID,
  text: 'Hello, world!',
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ── Success ──────────────────────────────────────────────────────────────────

describe('sendMessage — success', () => {
  it('resolves when Telegram returns ok:true', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(telegramResponse(true, 200, { ok: true }))

    await expect(sendMessage(BOT_TOKEN, input)).resolves.toBeUndefined()
  })

  it('sends to the correct Telegram API URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(telegramResponse(true, 200, { ok: true }))

    await sendMessage(BOT_TOKEN, input)

    expect(fetch).toHaveBeenCalledWith(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('sends the message body as JSON', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(telegramResponse(true, 200, { ok: true }))

    await sendMessage(BOT_TOKEN, input)

    const callArgs = vi.mocked(fetch).mock.calls[0]![1] as RequestInit
    const body = JSON.parse(callArgs.body as string)
    expect(body.chat_id).toBe(CHAT_ID)
    expect(body.text).toBe('Hello, world!')
    expect(body.parse_mode).toBe('HTML')
    expect(body.link_preview_options).toEqual({ is_disabled: true })
  })

  it('includes button as inline_keyboard when provided', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(telegramResponse(true, 200, { ok: true }))

    await sendMessage(BOT_TOKEN, {
      ...input,
      button: { text: 'Click me', url: 'https://example.com' },
    })

    const callArgs = vi.mocked(fetch).mock.calls[0]![1] as RequestInit
    const body = JSON.parse(callArgs.body as string)
    expect(body.reply_markup).toEqual({
      inline_keyboard: [[{ text: 'Click me', url: 'https://example.com' }]],
    })
  })

  it('omits reply_markup when no button', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(telegramResponse(true, 200, { ok: true }))

    await sendMessage(BOT_TOKEN, input)

    const callArgs = vi.mocked(fetch).mock.calls[0]![1] as RequestInit
    const body = JSON.parse(callArgs.body as string)
    expect(body).not.toHaveProperty('reply_markup')
  })
})

// ── Unreachable (403) ────────────────────────────────────────────────────────

describe('sendMessage — unreachable (403)', () => {
  it('throws TelegramUnreachableError on 403', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      telegramResponse(false, 403, {
        ok: false,
        description: 'Forbidden: bot was blocked by the user',
      }),
    )

    await expect(sendMessage(BOT_TOKEN, input)).rejects.toBeInstanceOf(TelegramUnreachableError)
  })

  it('includes chatId and description in the error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      telegramResponse(false, 403, {
        ok: false,
        description: 'Forbidden: bot was blocked by the user',
      }),
    )

    try {
      await sendMessage(BOT_TOKEN, input)
    } catch (err) {
      expect(err).toBeInstanceOf(TelegramUnreachableError)
      const e = err as TelegramUnreachableError
      expect(e.chatId).toBe(CHAT_ID)
      expect(e.description).toBe('Forbidden: bot was blocked by the user')
    }
  })
})

// ── Chat not found (400) ──────────────────────────────────────────────────────

describe('sendMessage — chat not found (400)', () => {
  it('throws TelegramUnreachableError when 400 with "chat not found"', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      telegramResponse(false, 400, { ok: false, description: 'Bad Request: chat not found' }),
    )

    await expect(sendMessage(BOT_TOKEN, input)).rejects.toBeInstanceOf(TelegramUnreachableError)
  })

  it('throws generic Error for 400 without "chat not found"', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      telegramResponse(false, 400, {
        ok: false,
        description: 'Bad Request: message text is empty',
      }),
    )

    await expect(sendMessage(BOT_TOKEN, input)).rejects.not.toBeInstanceOf(TelegramUnreachableError)
    await expect(sendMessage(BOT_TOKEN, input)).rejects.not.toBeInstanceOf(TelegramTransientError)
  })
})

// ── Rate limit (429) ──────────────────────────────────────────────────────────

describe('sendMessage — rate limit (429)', () => {
  it('throws TelegramTransientError on 429', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      telegramResponse(false, 429, { ok: false, description: 'Too Many Requests' }),
    )

    await expect(sendMessage(BOT_TOKEN, input)).rejects.toBeInstanceOf(TelegramTransientError)
  })
})

// ── Server error (5xx) ────────────────────────────────────────────────────────

describe('sendMessage — server error (5xx)', () => {
  it('throws TelegramTransientError on 500', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      telegramResponse(false, 500, { ok: false, description: 'Internal Server Error' }),
    )

    await expect(sendMessage(BOT_TOKEN, input)).rejects.toBeInstanceOf(TelegramTransientError)
  })

  it('throws TelegramTransientError on 502', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      telegramResponse(false, 502, { ok: false, description: 'Bad Gateway' }),
    )

    await expect(sendMessage(BOT_TOKEN, input)).rejects.toBeInstanceOf(TelegramTransientError)
  })

  it('throws TelegramTransientError on 503', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      telegramResponse(false, 503, { ok: false, description: 'Service Unavailable' }),
    )

    await expect(sendMessage(BOT_TOKEN, input)).rejects.toBeInstanceOf(TelegramTransientError)
  })
})

// ── Network failure ───────────────────────────────────────────────────────────

describe('sendMessage — network failure', () => {
  it('throws TelegramTransientError when fetch rejects', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('fetch failed'))

    await expect(sendMessage(BOT_TOKEN, input)).rejects.toBeInstanceOf(TelegramTransientError)
  })

  it('includes the original error message in the transient error', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('fetch failed'))

    try {
      await sendMessage(BOT_TOKEN, input)
    } catch (err) {
      expect(err).toBeInstanceOf(TelegramTransientError)
      expect((err as Error).message).toContain('fetch failed')
    }
  })
})

// ── Other error codes ────────────────────────────────────────────────────────

describe('sendMessage — other error codes', () => {
  it('throws a generic Error for unexpected status codes', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      telegramResponse(false, 404, { ok: false, description: 'Not Found' }),
    )

    await expect(sendMessage(BOT_TOKEN, input)).rejects.toMatchObject({
      message: expect.stringContaining('404'),
    })
  })

  it('uses "HTTP <status>" as description when body has no description', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('null', { status: 404, headers: { 'Content-Type': 'application/json' } }),
    )

    try {
      await sendMessage(BOT_TOKEN, input)
    } catch (err) {
      expect((err as Error).message).toContain('HTTP 404')
    }
  })
})

// ── Error class properties ───────────────────────────────────────────────────

describe('TelegramUnreachableError', () => {
  it('has name TelegramUnreachableError', () => {
    const err = new TelegramUnreachableError('123', 'blocked')
    expect(err.name).toBe('TelegramUnreachableError')
  })

  it('is an instance of Error', () => {
    const err = new TelegramUnreachableError('123', 'blocked')
    expect(err).toBeInstanceOf(Error)
  })
})

describe('TelegramTransientError', () => {
  it('has name TelegramTransientError', () => {
    const err = new TelegramTransientError('rate limited')
    expect(err.name).toBe('TelegramTransientError')
  })

  it('is an instance of Error', () => {
    const err = new TelegramTransientError('rate limited')
    expect(err).toBeInstanceOf(Error)
  })
})
