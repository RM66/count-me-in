import { type AppLocale, isAppLocale } from '@repo/contracts'

/** `weekStartsOn` values as react-day-picker (and our week grid) expect them. */
export type WeekStartsOn = 0 | 1 | 2 | 3 | 4 | 5 | 6

/**
 * The first day of the week per supported UI locale, in react-day-picker's
 * `weekStartsOn` convention (0 = Sunday … 6 = Saturday).
 *
 * A static table, not `Intl.Locale.getWeekInfo()`: that API maximizes a bare
 * tag to a default region (`en` → US → Sunday, `pt` → BR → Sunday), its
 * support differs across Node and browser engines, and it is not yet in the
 * TS DOM lib — so server and client could disagree. These values freeze the
 * CLDR default-region answer for each supported locale; the interface
 * language is the only regional signal we have (ADR-011 — no region data).
 */
const WEEK_STARTS_ON: Record<AppLocale, WeekStartsOn> = {
  en: 0, // en-US — Sunday
  de: 1, // de-DE — Monday
  es: 1, // es-ES — Monday
  fr: 1, // fr-FR — Monday
  pt: 0, // pt-BR — Sunday
  ru: 1, // ru-RU — Monday
  ar: 6, // ar-EG — Saturday
  ja: 0, // ja-JP — Sunday
}

export function localeWeekStartsOn(language: string): WeekStartsOn {
  return isAppLocale(language) ? WEEK_STARTS_ON[language] : 1
}
