/**
 * Telegram Bot API client — just `sendMessage`, over `fetch`.
 * No SDK: one endpoint, one method, and a dependency here would be more code
 * to audit than the request it replaces.
 *
 * The interesting part is not the call but the **error classification**. A
 * notification worker that retries everything is worse than one that retries
 * nothing: the single most common failure is a recipient who never pressed
 * Start on the bot (see docs/architecture.md — a bot may only message users who
 * did), and that never becomes deliverable no matter how many times it is
 * tried. Retrying it burns the job's budget, fills the log with noise, and
 * still ends in `failed`.
 */

/** A link rendered as a tappable button under the message. */
export interface MessageButton {
  text: string
  url: string
}

export interface SendMessageInput {
  chatId: string
  /** HTML-formatted body — every interpolated value must already be escaped. */
  text: string
  button?: MessageButton
}

/**
 * Why a send did not happen, when it is not worth retrying.
 * `unreachable` covers both "never started the bot" (403) and "chat not found"
 * (400): from the queue's point of view they are the same event — the recipient
 * cannot be messaged, and the job is done as well as it ever will be.
 */
export class TelegramUnreachableError extends Error {
  constructor(
    readonly chatId: string,
    readonly description: string,
  ) {
    super(`Telegram cannot reach chat ${chatId}: ${description}`)
    this.name = 'TelegramUnreachableError'
  }
}

/** A transient failure — rate limit, outage, network. The job should retry. */
export class TelegramTransientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TelegramTransientError'
  }
}

interface TelegramResponse {
  ok: boolean
  description?: string
  error_code?: number
}

/**
 * Send one message.
 * `link_preview_options.is_disabled` keeps Telegram from unfurling the cabinet
 * or booking URL: the preview would be a screenshot-sized card for a page that
 * requires the recipient's own credentials, and — for the one-time login link —
 * a preview fetch is exactly the robot request the POST-to-consume design
 * exists to defeat.
 */
export async function sendMessage(botToken: string, input: SendMessageInput): Promise<void> {
  const body = {
    chat_id: input.chatId,
    text: input.text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(input.button
      ? {
          reply_markup: {
            inline_keyboard: [[{ text: input.button.text, url: input.button.url }]],
          },
        }
      : {}),
  }

  let response: Response
  try {
    response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw new TelegramTransientError(
      `Telegram request failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (response.ok) return

  const payload = (await response.json().catch(() => null)) as TelegramResponse | null
  const description = payload?.description ?? `HTTP ${response.status}`

  if (response.status === 403 || (response.status === 400 && /chat not found/i.test(description))) {
    throw new TelegramUnreachableError(input.chatId, description)
  }

  if (response.status === 429 || response.status >= 500) {
    throw new TelegramTransientError(`Telegram ${response.status}: ${description}`)
  }

  throw new Error(`Telegram rejected the message (${response.status}): ${description}`)
}
