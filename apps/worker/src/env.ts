/**
 * Required configuration, read once at boot.
 *
 * Checked eagerly rather than at first use: a worker missing its bot token
 * would otherwise start cleanly, claim jobs and fail each one, burning the
 * retry budget on a misconfiguration. Failing at startup makes a bad deploy
 * obvious instead of quietly lossy.
 */

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is not set`)
  }
  return value
}

export interface WorkerEnv {
  databaseUrl: string
  telegramBotToken: string
  /** Public origin used to build every link in a message (no trailing slash). */
  appUrl: string
}

export function readEnv(): WorkerEnv {
  // `REDIS_URL` is read by `@repo/redis` at first connect, not held here — but
  // it is still asserted at boot, for the reason above: the worker's login
  // links are useless without it, and discovering that on the first booking is
  // discovering it too late.
  required('REDIS_URL')

  return {
    databaseUrl: required('DATABASE_URL'),
    telegramBotToken: required('TELEGRAM_BOT_TOKEN'),
    appUrl: required('APP_URL').replace(/\/+$/, ''),
  }
}
