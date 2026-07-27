import type { Messenger } from '@repo/api-contracts'

/**
 * Delivery of OTP codes over a messenger channel (ADR-005).
 *
 * MVP target is Telegram via the worker (`pg-boss` job). Until the Telegram
 * adapter lands, the dev sender logs the code to the server console so the
 * flow is fully testable locally.
 */
export interface OtpSender {
  send(phone: string, messenger: Messenger, code: string): Promise<void>
}

const consoleSender: OtpSender = {
  async send(phone, messenger, code) {
    console.info(`[otp] ${messenger} → ${phone}: code ${code}`)
  },
}

/** TODO: replace with Telegram adapter (enqueue `otp.send` via pg-boss) once the bot exists. */
export function getOtpSender(): OtpSender {
  return consoleSender
}
