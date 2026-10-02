import { DEFAULT_LOCALE, LOCALES } from '@repo/contracts'
import { describe, expect, it } from 'vitest'

import { API_ERROR_MESSAGES, NOTIFICATION_MESSAGES, WEB_MESSAGES } from './index'

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

type Leaf = { path: string; value: string }

function leaves(node: TreeNode, prefix = ''): Leaf[] {
  if (typeof node === 'string') return [{ path: prefix, value: node }]
  if (Array.isArray(node)) {
    return node.flatMap((item, index) => leaves(item, `${prefix}[${index}]`))
  }
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return leaves(value, path)
  })
}

/**
 * Argument names an ICU message references: `{name}` placeholders and the
 * `{name, plural, …}` argument itself, plus placeholders nested inside plural
 * clause bodies (`{count, plural, other {{name} has #}}` → {count, name}).
 * Clause *selector* text (`{seat}` in `=1 {seat}`) is literal copy, not an
 * argument — the parser consumes the balanced clause body instead of
 * pattern-matching braces, which is why a regex cannot be used here.
 */
function argNames(msg: string): Set<string> {
  const names = new Set<string>()
  let i = 0
  while (i < msg.length) {
    if (msg[i] !== '{') {
      i++
      continue
    }
    let j = i + 1
    while (j < msg.length && msg[j] !== ',' && msg[j] !== '}' && msg[j] !== '{') j++
    if (j >= msg.length || msg[j] === '{') {
      i++
      continue
    }
    const name = msg.slice(i + 1, j).trim()
    if (name) names.add(name)
    if (msg[j] === '}') {
      i = j + 1
      continue
    }
    // Complex argument: skip `{name, keyword,` then walk `selector {body}` pairs.
    let p = j + 1
    while (p < msg.length && msg[p] !== ',') p++
    p++ // past the comma before the clause list
    while (p < msg.length) {
      while (p < msg.length && ' \t\n\r'.includes(msg[p]!)) p++
      if (p >= msg.length || msg[p] === '}') break
      while (p < msg.length && !'{ \t\n\r}'.includes(msg[p]!)) p++ // selector
      while (p < msg.length && ' \t\n\r'.includes(msg[p]!)) p++
      if (p >= msg.length || msg[p] !== '{') break
      const bodyStart = p++
      let depth = 1
      while (p < msg.length && depth > 0) {
        if (msg[p] === '{') depth++
        else if (msg[p] === '}') depth--
        p++
      }
      for (const inner of argNames(msg.slice(bodyStart + 1, p - 1))) names.add(inner)
    }
    i = p + 1 // past the argument's closing '}'
  }
  return names
}

const DICTIONARIES = {
  messages: WEB_MESSAGES,
  notifications: NOTIFICATION_MESSAGES,
  'api-errors': API_ERROR_MESSAGES,
} as const

const translatedLocales = LOCALES.filter((locale) => locale !== DEFAULT_LOCALE)

for (const [name, dict] of Object.entries(DICTIONARIES)) {
  const enLeaves = leaves(dict[DEFAULT_LOCALE] as TreeNode)
  const enByPath = new Map(enLeaves.map((leaf) => [leaf.path, leaf.value]))

  describe(name, () => {
    for (const locale of translatedLocales) {
      it(`${locale} has exactly the keys of ${DEFAULT_LOCALE}`, () => {
        const localized = leaves(dict[locale] as TreeNode)
        expect(localized.map((leaf) => leaf.path).sort()).toEqual(
          enLeaves.map((leaf) => leaf.path).sort(),
        )
        // Same keys, same contract: no empty copy, and every `{placeholder}`
        // or plural argument names the same params as the English original —
        // a typo'd `{nmae}` would render literally instead of failing here.
        for (const leaf of localized) {
          expect(leaf.value.trim(), `${locale} ${leaf.path}`).not.toBe('')
          expect(
            [...argNames(leaf.value)].sort(),
            `${locale} ${leaf.path}`,
          ).toEqual([...argNames(enByPath.get(leaf.path)!)].sort())
        }
      })
    }
  })
}

describe('NOTIFICATION_MESSAGES', () => {
  it('messages contain no Telegram HTML tags (they are composed in code)', () => {
    for (const locale of LOCALES) {
      for (const leaf of leaves(NOTIFICATION_MESSAGES[locale] as TreeNode)) {
        expect(leaf.value, `${locale} ${leaf.path}`).not.toMatch(/<\/?(?:b|i|u|s|a|code|pre)>/)
      }
    }
  })
})
