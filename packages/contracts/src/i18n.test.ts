import { describe, expect, it } from 'vitest'

import { isAppLocale, matchLocale } from './i18n'

describe('matchLocale', () => {
  it('returns the exact locale for a bare tag', () => {
    expect(matchLocale('ru')).toBe('ru')
    expect(matchLocale('en')).toBe('en')
  })

  it('returns the locale for a regional tag', () => {
    expect(matchLocale('ru-RU')).toBe('ru')
    expect(matchLocale('en-US')).toBe('en')
  })

  it('skips unsupported tags and falls through in quality order', () => {
    expect(matchLocale('fr-FR,fr;q=0.9,ru;q=0.8')).toBe('ru')
    expect(matchLocale('de,ru-RU;q=0.5')).toBe('ru')
  })

  it('prefers the higher q value regardless of list order', () => {
    expect(matchLocale('en;q=0.4,ru;q=0.6')).toBe('ru')
    expect(matchLocale('ru;q=0.6,en;q=0.4')).toBe('ru')
  })

  it('breaks q ties by list order', () => {
    expect(matchLocale('en,ru')).toBe('en')
    expect(matchLocale('ru,en')).toBe('ru')
  })

  it('treats q=0 as unacceptable', () => {
    expect(matchLocale('ru;q=0,en')).toBe('en')
    expect(matchLocale('ru;q=0')).toBeNull()
  })

  it('treats a missing or malformed q as full preference', () => {
    expect(matchLocale('ru;q=oops,en')).toBe('ru')
    expect(matchLocale('ru,en;q=0.1')).toBe('ru')
  })

  it('handles case and spacing', () => {
    expect(matchLocale(' RU-ru , en')).toBe('ru')
  })

  it('returns null when nothing matches', () => {
    expect(matchLocale('fr-FR,de')).toBeNull()
    expect(matchLocale('')).toBeNull()
    expect(matchLocale(null)).toBeNull()
    expect(matchLocale(undefined)).toBeNull()
  })
})

describe('isAppLocale', () => {
  it('accepts supported locales only', () => {
    expect(isAppLocale('en')).toBe(true)
    expect(isAppLocale('ru')).toBe(true)
    expect(isAppLocale('en-US')).toBe(false)
    expect(isAppLocale('fr')).toBe(false)
    expect(isAppLocale('')).toBe(false)
  })
})
