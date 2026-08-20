import type { AppLocale } from '@repo/contracts'
import { DEFAULT_LOCALE, LOCALES } from '@repo/contracts'

/**
 * The languages offered in the UI, derived from the shared `LOCALES` set
 * (ADR-011) so the switcher, the signup form and the cabinet settings cannot
 * disagree about what is selectable. Labels are native endonyms — proper
 * nouns, intentionally untranslated.
 */
export interface LanguageOption {
  code: AppLocale
  label: string
}

const LANGUAGE_LABELS: Record<AppLocale, string> = {
  en: 'English',
  ru: 'Русский',
  es: 'Español',
  de: 'Deutsch',
  ja: '日本語',
  fr: 'Français',
}

export const LANGUAGES: LanguageOption[] = LOCALES.map((code) => ({
  code,
  label: LANGUAGE_LABELS[code],
}))

/** The fallback entry when the active locale is somehow not in the list. */
export const DEFAULT_LANGUAGE: LanguageOption = {
  code: DEFAULT_LOCALE,
  label: LANGUAGE_LABELS[DEFAULT_LOCALE],
}
