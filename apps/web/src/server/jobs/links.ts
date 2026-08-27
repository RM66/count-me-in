/**
 * Every URL that appears in a notification.
 *
 * Collected in one module because they are the *product* of a notification —
 * the message text is context, the link is the thing the recipient acts on —
 * and because each one encodes a routing decision from docs/pages.md that
 * should not be re-derived by hand in each template.
 */

import 'server-only'

/**
 * Cabinet bookings, filtered to one slot.
 * Relative on purpose: this is the `next` stored inside a login-link payload,
 * and the redirect happens after the session is established.
 */
export function cabinetSlotPath(timeSlotId: string): string {
  return `/cabinet/bookings?slot=${encodeURIComponent(timeSlotId)}`
}

/** The one-time login link that establishes a session and then opens `next`. */
export function loginLinkUrl(appUrl: string, token: string): string {
  return `${appUrl}/login/link/${encodeURIComponent(token)}`
}

/** The guest's booking management page — their `manageToken` is the credential. */
export function manageBookingUrl(appUrl: string, manageToken: string): string {
  return `${appUrl}/booking/${encodeURIComponent(manageToken)}`
}

/** The organizer's public page, used to offer a cancelled guest a way to rebook. */
export function organizerPageUrl(appUrl: string, slug: string): string {
  return `${appUrl}/${encodeURIComponent(slug)}`
}
