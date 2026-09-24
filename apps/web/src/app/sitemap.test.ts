import { describe, expect, it, vi } from 'vitest'

import { SITE_URL } from '@/constants/site'

// The sitemap is wiring, not data: static pages plus the catalog reads.
// The reads themselves are pinned by reads.integration.test.ts — here the
// DB modules are stubbed so the shape survives without Postgres.
vi.mock('@/server/db/organizer', () => ({
  listPublicOrganizerSlugs: vi.fn(async () => [{ slug: 'studio-demo' }, { slug: 'yoga-club' }]),
}))

vi.mock('@/server/db/service', () => ({
  listPublicServicePaths: vi.fn(async () => [{ orgSlug: 'studio-demo', serviceId: 'demo-yoga' }]),
}))

describe('sitemap', () => {
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
