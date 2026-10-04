import type { WebMessages } from '@repo/translations'

/**
 * Client namespace picking.
 *
 * Shipping the whole dictionary to the browser (35–56 KB per locale) means
 * every page downloads `Cabinet`, `Marketing`, `Legal`, … whether or not a
 * single client component on it translates. The root provider carries only
 * the namespaces root-level client components need; each route-group layout
 * nests a provider with its own pick — a nested `NextIntlClientProvider`
 * *replaces* the parent's `messages` rather than merging, so every segment
 * re-declares `BASE_NAMESPACES`.
 */

/** Namespaces rendered by client components under *any* segment:
 * shadcn primitives (`Ui`), the shared `ErrorState` (`GlobalError`), and
 * the locale switcher (`LocaleSwitcher`, mounted by every layout). */
const BASE_NAMESPACES = ['Ui', 'GlobalError', 'LocaleSwitcher'] as const

/** Root-only additions: the consent banner lives in `app/providers.tsx`. */
const ROOT_NAMESPACES = [...BASE_NAMESPACES, 'CookieConsent'] as const

/** Slice a dictionary to the given top-level namespaces.
 * `getMessages()` returns a loosely-typed record; the key set is
 * constrained to `WebMessages` so callers cannot pick a namespace that
 * does not exist, and the result is cast back for the provider. */
function pick<K extends keyof WebMessages>(
  messages: Record<string, unknown>,
  namespaces: readonly K[],
): Pick<WebMessages, K> {
  return Object.fromEntries(namespaces.map((key) => [key, messages[key]])) as Pick<WebMessages, K>
}

/** What the root `NextIntlClientProvider` ships. */
export function rootClientMessages(messages: Record<string, unknown>) {
  return pick(messages, ROOT_NAMESPACES)
}

/** What a route-group layout's nested provider ships. */
export function segmentClientMessages<K extends keyof WebMessages>(
  messages: Record<string, unknown>,
  namespaces: readonly K[],
) {
  return pick(messages, [...BASE_NAMESPACES, ...namespaces])
}
