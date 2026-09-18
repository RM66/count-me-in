import { describe, expect, it } from 'vitest'

import { DEMO_ORGANIZER_SLUG } from './demo'
import { organizerEnvelope, publicOrganizer } from './index'

const demoOrganizer = {
  id: '01930000-0000-7000-8000-0000000000de',
  slug: DEMO_ORGANIZER_SLUG,
  name: 'Demo',
  messenger: 'telegram' as const,
  messengerId: '1',
  timezone: 'Europe/Belgrade',
  description: null,
  photoUrl: null,
  location: null,
  contact: null,
  language: 'en' as const,
  createdAt: '2026-01-02T03:04:05.000Z',
  isDemo: true,
}

describe('demo organizer records', () => {
  it('organizerEnvelope accepts the demo slug', () => {
    const r = organizerEnvelope.safeParse({ organizer: demoOrganizer })
    expect(r.success).toBe(true)
  })

  it('publicOrganizer accepts the demo slug', () => {
    const r = publicOrganizer.safeParse({
      id: demoOrganizer.id,
      slug: demoOrganizer.slug,
      name: demoOrganizer.name,
      timezone: demoOrganizer.timezone,
      description: demoOrganizer.description,
      photoUrl: demoOrganizer.photoUrl,
      location: demoOrganizer.location,
      contact: demoOrganizer.contact,
      isDemo: demoOrganizer.isDemo,
    })
    expect(r.success).toBe(true)
  })
})
