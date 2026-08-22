import { describe, expect, it } from 'vitest'

import { mapSearchUrl } from './location'

describe('mapSearchUrl', () => {
  it('builds a search URL from an address', () => {
    expect(mapSearchUrl('Mala Stanica, Belgrade')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Mala%20Stanica%2C%20Belgrade',
    )
  })

  it('keeps an explicit maps link as-is', () => {
    expect(mapSearchUrl('https://maps.app.goo.gl/abc123')).toBe('https://maps.app.goo.gl/abc123')
  })

  it('adds the scheme to a bare-domain link', () => {
    expect(mapSearchUrl('yandex.ru/maps/?text=cafe')).toBe('https://yandex.ru/maps/?text=cafe')
  })

  it('trims whitespace before encoding', () => {
    expect(mapSearchUrl('  Central Park  ')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Central%20Park',
    )
  })

  it('keeps special characters safe in the query parameter', () => {
    expect(mapSearchUrl('Café "Zur Rose" & Bar')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Caf%C3%A9%20%22Zur%20Rose%22%20%26%20Bar',
    )
  })
})
