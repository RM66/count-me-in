import { describe, expect, it } from 'vitest'

import robots from './robots'

// Privacy surface pin: token-bearing and organizer-only pages must stay
// out of crawlers. robots.ts is pure — no DB, no mocks.
describe('robots', () => {
  it('allows crawling and points at the sitemap', () => {
    const rules = robots()
    expect((rules.rules as { allow?: string }[])[0]?.allow).toBe('/')
    expect(rules.sitemap).toMatch(/\/sitemap\.xml$/)
  })

  it('disallows the API, cabinet, booking management and login links', () => {
    const rules = robots()
    const disallow = (rules.rules as { disallow?: string }[])[0]?.disallow
    expect(disallow).toContain('/api/')
    expect(disallow).toContain('/cabinet/')
    // The manageToken lives in /booking/{token} URLs and one-time links in
    // /login/link/{token} — either indexed means a leaked credential.
    expect(disallow).toContain('/booking/')
    expect(disallow).toContain('/login/link/')
  })
})
