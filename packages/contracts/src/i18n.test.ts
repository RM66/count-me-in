import { describe, expect, it } from 'vitest'

import { isAppLocale, localeDirection } from './i18n'

describe('isAppLocale', () => {
  it('accepts supported locales only', () => {
    expect(isAppLocale('en')).toBe(true)
    expect(isAppLocale('ru')).toBe(true)
    expect(isAppLocale('es')).toBe(true)
    expect(isAppLocale('de')).toBe(true)
    expect(isAppLocale('ja')).toBe(true)
    expect(isAppLocale('fr')).toBe(true)
    expect(isAppLocale('pt')).toBe(true)
    expect(isAppLocale('ar')).toBe(true)
    expect(isAppLocale('en-US')).toBe(false)
    expect(isAppLocale('nl')).toBe(false)
    expect(isAppLocale('')).toBe(false)
  })
})

describe('localeDirection', () => {
  it('uses RTL only for Arabic', () => {
    expect(localeDirection('ar')).toBe('rtl')
    expect(localeDirection('en')).toBe('ltr')
    expect(localeDirection('ru')).toBe('ltr')
    expect(localeDirection('unknown')).toBe('ltr')
  })
})
