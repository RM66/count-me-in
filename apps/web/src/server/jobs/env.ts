/**
 * Configuration the job handlers need, read per delivery.
 *
 * Checked when a job runs rather than at boot — there is no long-lived worker
 * process anymore (ADR-012); the receiver endpoint is a serverless function,
 * so "startup" is every request. A missing variable must fail that delivery
 * loudly (500 → QStash retries → Sentry) instead of silently skipping.
 */

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is not set`)
  }
  return value
}

export interface JobsEnv {
  telegramBotToken: string
  /** Public origin used to build every link in a message (no trailing slash). */
  appUrl: string
}

export function readJobsEnv(): JobsEnv {
  return {
    telegramBotToken: required('TELEGRAM_BOT_TOKEN'),
    appUrl: required('APP_URL').replace(/\/+$/, ''),
  }
}
