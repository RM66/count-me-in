import { createHash } from 'node:crypto'

/**
 * SHA-256 hex of a manage token — the lookup key for the guest booking
 * management page and cancellation. The raw
 * token is a password-equivalent credential; the database stores only
 * this hash for credential checks. Node-only (server side): the browser
 * never needs to hash a token — it sends the raw value in the request
 * body, and the server hashes it before lookup.
 *
 * Parity: `HashManageToken` in `apps/web/pkg/db/shared.go` — the same
 * function on the Go side. A change here requires the same change there.
 */
export function hashManageToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}
