import { describe, expect, it } from 'vitest'

import { escapeJsonForHtml } from '@/components/json-ld'

describe('escapeJsonForHtml', () => {
  it('escapes </script> so organizer text cannot break out of the tag', () => {
    const json = JSON.stringify({ name: '</script><script>alert(1)</script>' })
    const escaped = escapeJsonForHtml(json)
    expect(escaped).not.toContain('</script>')
    expect(escaped).not.toContain('<script>')
    // The payload stays valid JSON — the escapes are JSON unicode escapes.
    expect(JSON.parse(escaped)).toEqual({ name: '</script><script>alert(1)</script>' })
  })

  it('escapes &, <, > and the U+2028/U+2029 line separators', () => {
    const escaped = escapeJsonForHtml('a & b < c > d\u2028e\u2029f')
    expect(escaped).toBe('a \\u0026 b \\u003c c \\u003e d\\u2028e\\u2029f')
  })

  it('leaves ordinary JSON untouched', () => {
    const json = '{"@type":"Organization","name":"Yoga Studio"}'
    expect(escapeJsonForHtml(json)).toBe(json)
  })
})
