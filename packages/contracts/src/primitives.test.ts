import { describe, expect, it } from 'vitest'

import {
  capacity,
  displayName,
  durationMinutes,
  manageToken,
  optionLabel,
  priceText,
  seats,
  serviceId,
  slug,
  slugShape,
  timezone,
  uuid,
} from './primitives'

describe('slug', () => {
  it('parses a valid slug', () => {
    expect(slug.safeParse('yoga-studio').success).toBe(true)
  })

  it('parses a 4-character slug (minimum)', () => {
    expect(slug.safeParse('abcd').success).toBe(true)
  })

  it('rejects a slug shorter than 4 characters', () => {
    expect(slug.safeParse('abc').success).toBe(false)
  })

  it('rejects a slug longer than 40 characters', () => {
    expect(slug.safeParse('a'.repeat(41)).success).toBe(false)
  })

  it('normalizes uppercase to lowercase', () => {
    const result = slug.safeParse('Yoga-Studio')
    expect(result.success).toBe(true)
    expect(result.data).toBe('yoga-studio')
  })

  it('rejects a slug with double hyphens', () => {
    expect(slug.safeParse('yoga--studio').success).toBe(false)
  })

  it('rejects a reserved slug (api)', () => {
    expect(slug.safeParse('api').success).toBe(false)
  })

  it('rejects a reserved slug (cabinet)', () => {
    expect(slug.safeParse('cabinet').success).toBe(false)
  })

  it('rejects the demo slug', () => {
    expect(slug.safeParse('demo').success).toBe(false)
  })

  it('slugShape accepts the reserved demo slug as a stored value', () => {
    expect(slugShape.safeParse('demo').success).toBe(true)
  })

  it('rejects a slug with invalid characters', () => {
    expect(slug.safeParse('yoga_studio').success).toBe(false)
    expect(slug.safeParse('yoga.studio').success).toBe(false)
  })
})

describe('timezone', () => {
  it('parses a valid IANA timezone', () => {
    expect(timezone.safeParse('Europe/Belgrade').success).toBe(true)
  })

  it('parses UTC', () => {
    expect(timezone.safeParse('UTC').success).toBe(true)
  })

  it('rejects an invalid timezone', () => {
    expect(timezone.safeParse('Not/AZone').success).toBe(false)
  })

  // Parity vector with pkg/validation TestTimezoneRuleCaseInsensitive: IANA ids
  // are case-insensitive, and "Local" is a Go-only name neither side accepts.
  it('accepts case-insensitive IANA ids like the Go API', () => {
    expect(timezone.safeParse('europe/belgrade').success).toBe(true)
    expect(timezone.safeParse('america/new_york').success).toBe(true)
    expect(timezone.safeParse('Local').success).toBe(false)
    expect(timezone.safeParse('Europe/Belgrade/Extra').success).toBe(false)
  })
})

/**
 * Parity with the Go length rule (pkg/validation): length bounds are
 * UTF-16 code units (JS String.length), not bytes. These vectors keep the Go
 * port from drifting back to byte length for multi-byte text.
 */
describe('UTF-16 length bounds', () => {
  it('measures multi-byte text in code units, not bytes', () => {
    expect(displayName.safeParse('я'.repeat(100)).success).toBe(true)
    expect(displayName.safeParse('я'.repeat(101)).success).toBe(false)
  })

  it('counts a non-BMP rune as two code units', () => {
    expect(displayName.safeParse('😀'.repeat(50)).success).toBe(true)
    expect(displayName.safeParse('😀'.repeat(51)).success).toBe(false)
  })

  it('applies the same rule to option labels and price text', () => {
    expect(optionLabel.safeParse('я'.repeat(100)).success).toBe(true)
    expect(optionLabel.safeParse('я'.repeat(101)).success).toBe(false)
    expect(priceText.safeParse('я'.repeat(50)).success).toBe(true)
    expect(priceText.safeParse('я'.repeat(51)).success).toBe(false)
  })
})

describe('serviceId', () => {
  it('parses a valid service id', () => {
    expect(serviceId.safeParse('svc-abc123').success).toBe(true)
  })

  it('rejects a service id shorter than 6 characters', () => {
    expect(serviceId.safeParse('abc').success).toBe(false)
  })

  it('rejects a service id with invalid characters', () => {
    expect(serviceId.safeParse('svc abc!').success).toBe(false)
  })
})

describe('seats', () => {
  it('accepts 1', () => {
    expect(seats.safeParse(1).success).toBe(true)
  })

  it('rejects 0', () => {
    expect(seats.safeParse(0).success).toBe(false)
  })

  it('rejects 1001', () => {
    expect(seats.safeParse(1001).success).toBe(false)
  })

  it('rejects a non-integer', () => {
    expect(seats.safeParse(1.5).success).toBe(false)
  })
})

describe('capacity', () => {
  it('accepts 1', () => {
    expect(capacity.safeParse(1).success).toBe(true)
  })

  it('rejects 0', () => {
    expect(capacity.safeParse(0).success).toBe(false)
  })

  it('rejects 100001', () => {
    expect(capacity.safeParse(100001).success).toBe(false)
  })
})

describe('durationMinutes', () => {
  it('accepts 60', () => {
    expect(durationMinutes.safeParse(60).success).toBe(true)
  })

  it('rejects 0', () => {
    expect(durationMinutes.safeParse(0).success).toBe(false)
  })

  it('rejects more than 1440', () => {
    expect(durationMinutes.safeParse(1441).success).toBe(false)
  })
})

describe('uuid', () => {
  it('parses a valid uuid', () => {
    expect(uuid.safeParse('01930000-0000-7000-8000-000000000001').success).toBe(true)
  })

  it('rejects an invalid uuid', () => {
    expect(uuid.safeParse('not-a-uuid').success).toBe(false)
  })
})

describe('manageToken', () => {
  it('rejects a token shorter than 10 characters', () => {
    expect(manageToken.safeParse('short').success).toBe(false)
  })

  it('accepts a valid token', () => {
    expect(manageToken.safeParse('a'.repeat(32)).success).toBe(true)
  })
})
