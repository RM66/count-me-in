import { WEB_MESSAGES } from '@repo/translations'
import { describe, expect, it } from 'vitest'

import {
  AUTH_SEGMENT_NAMESPACES,
  GUEST_SEGMENT_NAMESPACES,
  segmentClientMessages,
} from './messages'

/**
 * A nested `NextIntlClientProvider` *replaces* the parent's messages, so a
 * namespace missing from a segment's list renders raw keys (MISSING_MESSAGE)
 * — caught live by Playwright, invisible to component tests: IntlTestProvider
 * feeds the whole dictionary. These pin the exact lists the layouts ship for
 * the shared client components mounted across segments.
 */
const SEGMENTS = {
  '(auth)': AUTH_SEGMENT_NAMESPACES,
  '(guest)': GUEST_SEGMENT_NAMESPACES,
} as const

describe('segment client namespaces', () => {
  for (const [segment, namespaces] of Object.entries(SEGMENTS)) {
    it(`${segment} ships TelegramLogin — TelegramLoginButton mounts on login, signup and guest verify`, () => {
      const messages = segmentClientMessages(WEB_MESSAGES.en, namespaces)
      expect(messages.TelegramLogin).toBeDefined()
      expect(typeof messages.TelegramLogin.button).toBe('string')
      expect(typeof messages.TelegramLogin.buttonGuest).toBe('string')
    })
  }
})
