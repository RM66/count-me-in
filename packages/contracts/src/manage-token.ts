import { createHash } from 'node:crypto'

/**
 * SHA-256 hex of a manage token — the lookup key for the guest booking
 * management page and cancellation. The raw
 * token is a password-equivalent credential; the database stores only
 * this hash for credential checks. Node-only (server side): the browser
 * never needs to hash a token — it sends the raw value in the request
 * body, and the server hashes it before lookup.
 *
 * Parity: `hash_manage_token` in the API (countmein/db/shared.py) — the
 * same function on the API side. The TS implementation has no
 * production callsite: it exists as the executable mirror pinned by the
 * shared vector `vectors/domain/hashManageToken.json` (vitest and
 * pytest run the same cases).
 */
export function hashManageToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}
