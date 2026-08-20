import { describe, expect, it } from 'vitest'

import { NOTIFICATION_MESSAGES, WEB_MESSAGES } from './index'

/**
 * The dictionaries must keep the same shape: a key added to English without a
 * translated counterpart would crash `t()` with a missing-message error at
 * runtime instead of failing any check. Recursively asserting key parity keeps
 * the source-of-truth discipline automatic.
 *
 * Messages can be strings, nested objects, or — for data-driven sections like
 * the FAQ or the hero carousel — arrays of objects; the walker descends into
 * all three shapes.
 */

type TreeNode = string | TreeNode[] | { [key: string]: TreeNode }

function leafPaths(node: TreeNode, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix]
  if (Array.isArray(node)) {
    return node.flatMap((item, index) => leafPaths(item, `${prefix}[${index}]`))
  }
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return leafPaths(value, path)
  })
}

describe('WEB_MESSAGES', () => {
  for (const locale of ['ru', 'es', 'de'] as const) {
    it(`${locale} has exactly the keys of en`, () => {
      expect(leafPaths(WEB_MESSAGES[locale] as TreeNode).sort()).toEqual(
        leafPaths(WEB_MESSAGES.en as TreeNode).sort(),
      )
    })
  }
})

describe('NOTIFICATION_MESSAGES', () => {
  for (const locale of ['ru', 'es', 'de'] as const) {
    it(`${locale} has exactly the keys of en`, () => {
      expect(leafPaths(NOTIFICATION_MESSAGES[locale] as TreeNode).sort()).toEqual(
        leafPaths(NOTIFICATION_MESSAGES.en as TreeNode).sort(),
      )
    })
  }

  it('messages contain no Telegram HTML tags (they are composed in code)', () => {
    for (const leaf of leafPaths(NOTIFICATION_MESSAGES.en as TreeNode)) {
      expect(leaf).not.toContain('<b>')
      expect(leaf).not.toContain('</b>')
    }
  })
})
