import { describe, expect, it } from 'vitest'

import { detectContactKind } from './contact'

describe('detectContactKind', () => {
  describe('phone', () => {
    it('classifies a phone number with country code', () => {
      const result = detectContactKind('+381 60 123 4567')
      expect(result.kind).toBe('phone')
      expect(result.href).toBe('tel:+381601234567')
    })

    it('classifies a phone number without country code', () => {
      const result = detectContactKind('060 123 4567')
      expect(result.kind).toBe('phone')
      expect(result.href).toBe('tel:0601234567')
    })

    it('classifies a phone number with parentheses and hyphens', () => {
      const result = detectContactKind('+1 (555) 123-4567')
      expect(result.kind).toBe('phone')
      expect(result.href).toBe('tel:+15551234567')
    })
  })

  describe('email', () => {
    it('classifies a valid email', () => {
      const result = detectContactKind('hello@example.com')
      expect(result.kind).toBe('email')
      expect(result.href).toBe('mailto:hello@example.com')
    })
  })

  describe('url', () => {
    it('classifies an https URL', () => {
      const result = detectContactKind('https://example.com')
      expect(result.kind).toBe('url')
      expect(result.href).toBe('https://example.com')
    })

    it('classifies an http URL', () => {
      const result = detectContactKind('http://example.com')
      expect(result.kind).toBe('url')
      expect(result.href).toBe('http://example.com')
    })

    it('classifies a t.me link', () => {
      const result = detectContactKind('t.me/mybot')
      expect(result.kind).toBe('url')
      expect(result.href).toBe('https://t.me/mybot')
    })

    it('classifies a www URL', () => {
      const result = detectContactKind('www.example.com')
      expect(result.kind).toBe('url')
      expect(result.href).toBe('https://www.example.com')
    })

    it('classifies a bare domain', () => {
      const result = detectContactKind('example.com')
      expect(result.kind).toBe('url')
      expect(result.href).toBe('https://example.com')
    })
  })

  describe('text', () => {
    it('classifies plain text as text', () => {
      const result = detectContactKind('hello world')
      expect(result.kind).toBe('text')
      expect(result.href).toBeUndefined()
    })

    it('classifies an empty string as text', () => {
      const result = detectContactKind('')
      expect(result.kind).toBe('text')
    })

    it('trims whitespace before classifying', () => {
      const result = detectContactKind('  hello  ')
      expect(result.kind).toBe('text')
    })
  })
})
