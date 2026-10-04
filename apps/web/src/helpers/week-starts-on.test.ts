import { describe, expect, it } from 'vitest'

import { localeWeekStartsOn } from '@/helpers/week-starts-on'

// The first day of the week follows the *app* locale (ADR-011) from a static
// table — not Intl.getWeekInfo, whose answer depends on the engine's CLDR
// version. Server page and client grid derive it from the same cookie value,
// so the fetched week and the rendered week always frame the same seven days.
describe('localeWeekStartsOn', () => {
  it('maps every supported locale to its conventional first weekday', () => {
    expect(localeWeekStartsOn('en')).toBe(0)
    expect(localeWeekStartsOn('de')).toBe(1)
    expect(localeWeekStartsOn('es')).toBe(1)
    expect(localeWeekStartsOn('fr')).toBe(1)
    expect(localeWeekStartsOn('pt')).toBe(0)
    expect(localeWeekStartsOn('ru')).toBe(1)
    expect(localeWeekStartsOn('ar')).toBe(6)
    expect(localeWeekStartsOn('ja')).toBe(0)
  })

  it('falls back to Monday outside the supported set', () => {
    // Runtime locales are always bare tags (matchLocale normalizes); a
    // regional tag or an unknown value lands on the European default.
    expect(localeWeekStartsOn('en-GB')).toBe(1)
    expect(localeWeekStartsOn('!!!')).toBe(1)
  })
})
