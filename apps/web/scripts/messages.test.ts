import {
  BOUNDS,
  displayName,
  OPTIONS_MAX,
  optionsList,
  optionsSelectModeEnum,
  seats,
  serviceDescription,
} from '@repo/contracts'
import { describe, expect, it } from 'vitest'

import { zodMessages } from './messages'

/**
 * These strings are reproduced verbatim in Go (pkg/validation). Zod owns the
 * wording; this test fails when a Zod upgrade changes it, so the Go templates
 * are updated deliberately instead of drifting.
 */
function firstMessage(result: {
  success: boolean
  error?: { issues: Array<{ message: string }> }
}): string {
  return result.error?.issues[0]?.message ?? ''
}

describe('Go rule messages match Zod', () => {
  it('string min/max', () => {
    expect(firstMessage(displayName.safeParse('x'.repeat(BOUNDS.displayName.max + 1)))).toBe(
      zodMessages.stringTooBig(BOUNDS.displayName.max),
    )
  })

  it('string max only', () => {
    expect(
      firstMessage(serviceDescription.safeParse('x'.repeat(BOUNDS.serviceDescription.max + 1))),
    ).toBe(zodMessages.stringTooBig(BOUNDS.serviceDescription.max))
  })

  it('int range', () => {
    expect(firstMessage(seats.safeParse(BOUNDS.seats.max + 1))).toBe(
      zodMessages.intTooBig(BOUNDS.seats.max),
    )
  })

  it('int min', () => {
    expect(firstMessage(seats.safeParse(BOUNDS.seats.min - 1))).toBe(
      zodMessages.intTooSmall(BOUNDS.seats.min),
    )
  })

  it('array min', () => {
    expect(firstMessage(optionsList.safeParse([]))).toBe(zodMessages.arrayTooSmall(1))
  })

  it('array max', () => {
    expect(
      firstMessage(optionsList.safeParse(Array.from({ length: OPTIONS_MAX + 1 }, () => 'x'))),
    ).toBe(zodMessages.arrayTooBig(OPTIONS_MAX))
  })

  it('enum', () => {
    expect(firstMessage(optionsSelectModeEnum.safeParse('nope'))).toBe(
      zodMessages.enumOneOf(optionsSelectModeEnum.options),
    )
  })
})
