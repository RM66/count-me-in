import { describe, expect, it, vi } from 'vitest'

import { SITE_URL } from '@/constants/site'

// The sitemap is wiring, not data: static pages plus the catalog read.
// The API contract is pinned by the Python parity suite — here the
// client is stubbed so the shape survives without a backend.
vi.mock('@/server/api-client', () => ({
  getPublicSitemap: vi.fn(async () => ({
    organizers: [{ slug: 'studio-demo' }, { slug: 'yoga-club' }],
    services: [{ orgSlug: 'studio-demo', serviceId: 'demo-yoga' }],
  })),
}))

describe('sitemap', () => {
  it('throws on an unexpected catalog 404 instead of masking it as empty', async () => {
    const { getPublicSitemap } = await import('@/server/api-client')
    vi.mocked(getPublicSitemap).mockRejectedValueOnce(
      new Error('API request failed: /api/public/sitemap answered 404'),
    )
    await expect((await import('./sitemap')).default()).rejects.toThrow('404')
  })

  it('lists static pages, organizer pages and service pages', async () => {
    const { default: sitemap } = await import('./sitemap')
    const entries = await sitemap()
    const urls = entries.map((e) => e.url)

    expect(urls).toContain(`${SITE_URL}/`)
    expect(urls).toContain(`${SITE_URL}/terms`)
    expect(urls).toContain(`${SITE_URL}/privacy`)
    expect(urls).toContain(`${SITE_URL}/studio-demo`)
    expect(urls).toContain(`${SITE_URL}/yoga-club`)
    expect(urls).toContain(`${SITE_URL}/studio-demo/demo-yoga`)
  })

  it('keeps /demo out: it is an ordinary /{orgSlug} page, not a separate entry', async () => {
    const { default: sitemap } = await import('./sitemap')
    const urls = (await sitemap()).map((e) => e.url)
    expect(urls).not.toContain(`${SITE_URL}/demo`)
  })
})
