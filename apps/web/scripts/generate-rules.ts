/**
 * Renders the wire registry's validation metadata (ADR-024 C2) into
 * `api/_lib/countmein/validation/rules_gen.py` — the decode driver on the
 * Python side reads transforms/fieldRules/refinements/mergedRequired from it,
 * so the two languages share one declaration in `packages/contracts/wire.ts`.
 *
 * Run via: `bun run generate:rules` (part of `generate:py`).
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WIRE_META } from '@repo/contracts/wire'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const pyOutFile = join(__dirname, '..', 'api', '_lib', 'countmein', 'validation', 'rules_gen.py')

function pyDict(value: Record<string, unknown>, indent: string): string {
  const entries = Object.entries(value)
  if (entries.length === 0) return '{}'
  const inner = entries.map(([k, v]) => `${indent}    ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
  return `{\n${inner.join(',\n')},\n${indent}}`
}

const blocks: string[] = []
for (const [id, meta] of Object.entries(WIRE_META)) {
  if (meta.validation === undefined) continue
  blocks.push(
    `${JSON.stringify(id)}: ${pyDict(meta.validation as Record<string, unknown>, '    ')}`,
  )
}

const pyContent = `# Generated from packages/contracts wire.ts via scripts/generate-rules.ts
# (ADR-024 C2). The validation metadata the OpenAPI document cannot carry —
# declared once at register() and mirrored by the Zod builders. Regenerate
# with: bun run generate:rules
#
# Per input schema:
#   transforms:     {property: ['trim' | 'lowercase', ...]} — applied to the
#                   raw JSON object before schema validation
#   fieldRules:     {property: ['ianaTimezone' | 'slugNotReserved' | 'httpUrl'
#                   | 'startsAtNotPast', ...]} — post-validation rules on
#                   non-null values
#   refinements:    ['optionsPair', ...] — object-level cross-field rules
#   mergedRequired: [property, ...] — update schemas only: keys the merged
#                   state must keep non-null (RFC 7386 null erases them)

from __future__ import annotations

from typing import Any

RULES: dict[str, dict[str, Any]] = {
    ${blocks.join(',\n    ')},
}
`

writeFileSync(pyOutFile, pyContent, 'utf8')
console.log(`Wrote ${pyOutFile}`)
