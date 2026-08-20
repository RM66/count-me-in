import { z } from 'zod'

/**
 * The app's UI locales (ADR-011).
 *
 * Locale is **not part of the URL**: the same route serves every language and
 * the choice travels in a cookie (viewer preference) or, at booking time, on
 * the booking row (the language the guest's confirmation message is rendered
 * in). Lives in contracts because both ends need it — `apps/web` renders UI
 * copy, `apps/worker` renders notifications — and they must agree on what a
 * locale string is.
 *
 * Add a language in one place here; the dictionaries live in
 * `packages/translations`.
 */

export const LOCALES = ['en', 'ru', 'es', 'de'] as const

export const appLocaleEnum = z.enum(LOCALES)
export type AppLocale = z.infer<typeof appLocaleEnum>

export const DEFAULT_LOCALE: AppLocale = 'en'

/** Type guard for strings read from cookies, headers or the database. */
export function isAppLocale(value: string): value is AppLocale {
  return appLocaleEnum.safeParse(value).success
}

/**
 * First supported locale in an `Accept-Language`-shaped string
 * (`ru-RU,ru;q=0.9,en;q=0.8`), honoring `q` weights (higher quality first,
 * list order breaking ties; `q=0` marks a tag as unacceptable), or `null` when
 * nothing matches. Shared by the web (server-side resolution) and the signup
 * form (browser detection), so both agree on how a browser preference becomes
 * a locale.
 */
export function matchLocale(acceptLanguage?: string | null): AppLocale | null {
  if (!acceptLanguage) return null

  const weighted = acceptLanguage
    .split(',')
    .map((part, index) => {
      const [rawTag, ...params] = part.split(';')
      const qParam = params.find((param) => param.trim().startsWith('q='))
      const qValue = qParam ? Number.parseFloat(qParam.slice(qParam.indexOf('q=') + 2)) : NaN
      return {
        tag: rawTag?.trim().toLowerCase() ?? '',
        // Absent or malformed `q` means full preference, as RFC 9110 defines.
        quality: Number.isFinite(qValue) ? qValue : 1,
        index,
      }
    })
    .filter(({ quality }) => quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index)

  for (const { tag } of weighted) {
    if (!tag) continue
    if (isAppLocale(tag)) return tag
    for (const locale of LOCALES) {
      if (tag.startsWith(`${locale}-`)) return locale
    }
  }
  return null
}
