/**
 * Code generator for contracts and validation across TypeScript, Go, and OpenAPI 3.1.
 *
 * Single Source of Truth: `packages/contracts/src/`
 *
 * Generated outputs:
 *   1. `apps/web/pkg/contracts/contracts_gen.go` (Go structs, enums, constants, calculations)
 *   2. `apps/web/pkg/validation/validation_gen.go` (Go validation rules and input parsers)
 *   3. `apps/web/openapi.yaml` (OpenAPI 3.1 specification)
 *
 * Structs, enums, rules and Parse* bodies are derived from the wire registry
 * (`packages/contracts/src/wire.ts`) rendered through the public
 * z.toJSONSchema API — Go names resolve by $ref, rules by JSON Schema
 * constraints. Paths come from `packages/contracts/src/routes.ts`.
 * Anything the emitter cannot derive (transforms, refinements,
 * temporal checks, domain functions) lives hand-written in rules.go /
 * refine.go / domain.go; the generator emits only calls and verifies the
 * callees exist. `assertOpenApiSpec` rejects a structurally broken spec, and
 * the cross-language vector tests in `packages/contracts/vectors` pin
 * behaviour on both sides.
 *
 * Run via: `bun run generate:contracts`
 * In CI: verified via `git diff --exit-code`
 */
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as contracts from '@repo/contracts'
import { API_ROUTES, INTERNAL_RECORDS } from '@repo/contracts/routes'
import { metaOfSchema, wire, WIRE_META, WIRE_SCHEMAS } from '@repo/contracts/wire'
import yaml from 'yaml'
import { z } from 'zod'

import { zodMessages } from './messages'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const webDir = join(__dirname, '..')

const goContractsFile = join(webDir, 'pkg', 'contracts', 'contracts_gen.go')
const goValidationFile = join(webDir, 'pkg', 'validation', 'validation_gen.go')
const openapiFile = join(webDir, 'openapi.yaml')

function goString(str: string): string {
  return JSON.stringify(str)
}

// RE2 (Go) is not a superset of the JS regex dialect: a lookaround or
// backreference compiles in TypeScript and panics inside regexp.MustCompile at
// Go package init, taking the whole function down on cold start.
const RE2_UNSUPPORTED = /\(\?=|\(\?!|\(\?<=|\(\?<!|\\[1-9]/
function goRegexSource(pattern: RegExp, name: string): string {
  if (RE2_UNSUPPORTED.test(pattern.source)) {
    throw new Error(
      `generate-contracts: ${name} uses a construct RE2 does not support (lookaround or backreference) — rewrite it or move the check into a hand-written rule`,
    )
  }
  if (pattern.source.includes('`')) {
    throw new Error(
      `generate-contracts: ${name} contains a backtick and cannot be emitted as a Go raw string literal`,
    )
  }
  return pattern.source
}

function toPascalCase(str: string): string {
  const pascal = str
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
  return pascal.replace(/Id\b/g, 'ID').replace(/Url\b/g, 'URL')
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON Schema machinery (stage 4).
// The wire registry is rendered once through the public z.toJSONSchema API;
// Go types and rules resolve by $ref name. Nothing here may read Zod
// internals or the standard-schema hook.
// ─────────────────────────────────────────────────────────────────────────────

type JSchema = {
  $ref?: string
  type?: string
  anyOf?: JSchema[]
  oneOf?: JSchema[]
  default?: unknown
  properties?: Record<string, JSchema>
  required?: string[]
  items?: JSchema
  additionalProperties?: JSchema | boolean
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number | boolean
  exclusiveMaximum?: number | boolean
  enum?: string[]
  format?: string
  pattern?: string
  minItems?: number
  maxItems?: number
}

const wireJSON = z.toJSONSchema(wire, {
  io: 'input',
  unrepresentable: 'any',
  uri: (id: string) => id,
}) as unknown as { schemas: Record<string, JSchema> }
const jsonSchemas: Record<string, JSchema> = wireJSON.schemas

function targetOf(id: string, where: string): JSchema {
  const t = jsonSchemas[id]
  if (!t) {
    throw new Error(`generate-contracts: $ref "${id}" in ${where} resolves to no registered schema`)
  }
  // A refined primitive (Slug = SlugShape.refine(policy)) renders as
  // `{ $ref: SlugShape }`. Follow the ref for the JSON Schema shape; callers
  // still use the original id with metaOf for the Go rule name.
  if (typeof t.$ref === 'string') {
    const refId = t.$ref.split('/').pop() as string
    if (refId === id) {
      throw new Error(`generate-contracts: ${where} $ref "${id}" is circular`)
    }
    return targetOf(refId, `${where} via ${id}`)
  }
  return t
}

function metaOf(
  id: string,
  where: string,
): {
  id: string
  kind: 'primitive' | 'enum' | 'input' | 'update' | 'record'
  'x-go-type'?: string
  'x-go-rule'?: string
  'x-go-refine'?: string
  'x-go-trim'?: true
  'x-go-enum-consts'?: Record<string, string>
} {
  const m = WIRE_META[id]
  if (!m) {
    throw new Error(
      `generate-contracts: "${id}" referenced by ${where} is not registered in wire.ts`,
    )
  }
  return m
}

type RefTarget = { id: string | null; nullable: boolean; def: unknown }

/**
 * Resolve a property schema to its $ref target, unwrapping the
 * anyOf/oneOf-with-null shape nullable() produces. Returns id null for
 * inline schemas (records only — inputs must $ref a registered schema, D11).
 */
function refOf(prop: JSchema): RefTarget {
  if (typeof prop.$ref === 'string') {
    const segs = prop.$ref.split('/')
    return { id: segs[segs.length - 1] as string, nullable: false, def: prop.default }
  }
  for (const key of ['anyOf', 'oneOf'] as const) {
    const branches = prop[key]
    if (!Array.isArray(branches) || branches.length !== 2) continue
    const nullIdx = branches.findIndex((b) => b.type === 'null' && b.$ref === undefined)
    if (nullIdx < 0) continue
    const other = branches[1 - nullIdx] as JSchema
    if (typeof other.$ref === 'string') {
      const segs = (other.$ref as string).split('/')
      return {
        id: segs[segs.length - 1] as string,
        nullable: true,
        def: (other as { default?: unknown }).default,
      }
    }
    return { id: null, nullable: true, def: undefined }
  }
  return { id: null, nullable: false, def: undefined }
}

const GO_KEYWORDS = new Set([
  'break',
  'case',
  'chan',
  'const',
  'continue',
  'default',
  'defer',
  'else',
  'fallthrough',
  'for',
  'func',
  'go',
  'goto',
  'if',
  'import',
  'interface',
  'map',
  'package',
  'range',
  'return',
  'select',
  'struct',
  'switch',
  'type',
  'var',
])
const GO_PREDECLARED = new Set([
  'append',
  'bool',
  'byte',
  'cap',
  'close',
  'complex',
  'complex64',
  'complex128',
  'copy',
  'delete',
  'error',
  'false',
  'float32',
  'float64',
  'imag',
  'int',
  'int8',
  'int16',
  'int32',
  'int64',
  'iota',
  'len',
  'make',
  'new',
  'nil',
  'panic',
  'print',
  'println',
  'real',
  'recover',
  'rune',
  'string',
  'true',
  'uint',
  'uint8',
  'uint16',
  'uint32',
  'uint64',
  'uintptr',
  'any',
  'comparable',
  'clear',
  'max',
  'min',
])

function guardFieldName(k: string, where: string, locals = true): void {
  // Parser bodies declare locals named after input/update keys; a key like
  // `out` or `range` would break compilation silently. Record keys only feed
  // PascalCase struct fields and json tags, so keywords are harmless there.
  if (
    k === 'e' ||
    k === 'm' ||
    k === 'out' ||
    (locals && (GO_KEYWORDS.has(k) || GO_PREDECLARED.has(k)))
  ) {
    throw new Error(
      `generate-contracts: field "${k}" in ${where} collides with a Go keyword, predeclared identifier, or parser local`,
    )
  }
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1)
}

/**
 * Go type for a $ref'd schema. Records nest by id; enums use x-go-type when
 * set; FlexTime is time.Time on input (Optional[FlexTime] on update, string
 * on records); arrays are []string only.
 */
function goRefType(
  r: { id: string },
  kind: 'input' | 'update' | 'record',
  k: string,
  where: string,
): string {
  const t = targetOf(r.id, where)
  const meta = metaOf(r.id, where)
  if (meta.kind === 'record') return r.id
  if (meta.kind === 'enum') return meta['x-go-type'] ?? r.id
  if (meta['x-go-type'] === 'FlexTime') {
    return kind === 'update' ? 'FlexTime' : kind === 'record' ? 'string' : 'time.Time'
  }
  if (t.type === 'string') return 'string'
  if (t.type === 'integer') return 'int'
  if (t.type === 'boolean') return 'bool'
  if (t.type === 'array') {
    // Arrays of records nest by id (envelopes); arrays of string primitives
    // stay flat ([]string); inline string items stay flat too.
    if (t.items && typeof t.items.$ref === 'string') {
      const segs = (t.items.$ref as string).split('/')
      const elemId = segs[segs.length - 1] as string
      const elemMeta = metaOf(elemId, `${where} items`)
      if (elemMeta.kind === 'record') return `[]${elemId}`
      const elemTarget = targetOf(elemId, `${where} items`)
      if (elemTarget.type === 'string' && elemMeta.kind === 'primitive') return '[]string'
      throw new Error(
        `generate-contracts: ${where} is an array of ${elemId} — only []string and []Record fields are ported`,
      )
    }
    const items = t.items ? refOf(t.items) : { id: null }
    if (items.id !== null) {
      const elemMeta = metaOf(items.id, `${where} items`)
      const elemTarget = targetOf(items.id, `${where} items`)
      if (elemTarget.type !== 'string' || elemMeta.kind !== 'primitive') {
        throw new Error(
          `generate-contracts: ${where} is an array of ${items.id} — only []string and []Record fields are ported`,
        )
      }
    } else if (t.items?.type !== 'string') {
      throw new Error(
        `generate-contracts: ${where} is an array of non-strings — only []string and []Record fields are ported`,
      )
    }
    return '[]string'
  }
  if (t.type === 'object' && t.additionalProperties && typeof t.additionalProperties === 'object') {
    const ap = t.additionalProperties as JSchema
    if (ap.type === 'array' && ap.items?.type === 'string') return 'map[string][]string'
    throw new Error(
      `generate-contracts: ${where} is a map of non-[]string — only map[string][]string is ported`,
    )
  }
  throw new Error(
    `generate-contracts: field "${k}" in ${where} has unsupported JSON Schema shape — teach goRefType about it instead of silently defaulting to string`,
  )
}

function inlineBaseType(prop: JSchema, where: string): string {
  if (prop.type === 'string') return 'string'
  if (prop.type === 'integer') return 'int'
  if (prop.type === 'boolean') return 'bool'
  if (prop.type === 'array') {
    // Envelope arrays nest records by id; string arrays stay flat.
    if (prop.items && typeof prop.items.$ref === 'string') {
      const segs = (prop.items.$ref as string).split('/')
      const elemId = segs[segs.length - 1] as string
      const elemMeta = metaOf(elemId, `${where} items`)
      if (elemMeta.kind === 'record') return `[]${elemId}`
      if (targetOf(elemId, `${where} items`).type === 'string' && elemMeta.kind === 'primitive') {
        return '[]string'
      }
      throw new Error(
        `generate-contracts: ${where} is an array of ${elemId} — only []string and []Record fields are ported`,
      )
    }
    if (prop.items && prop.items.type !== 'string') {
      throw new Error(
        `generate-contracts: ${where} is an array of non-strings — only []string and []Record fields are ported`,
      )
    }
    return '[]string'
  }
  if (
    prop.type === 'object' &&
    prop.additionalProperties &&
    typeof prop.additionalProperties === 'object'
  ) {
    const ap = prop.additionalProperties as JSchema
    if (ap.type === 'array' && ap.items?.type === 'string') return 'map[string][]string'
    throw new Error(
      `generate-contracts: ${where} is a map of non-[]string — only map[string][]string is ported`,
    )
  }
  for (const key of ['anyOf', 'oneOf'] as const) {
    const branches = prop[key]
    if (!Array.isArray(branches) || branches.length !== 2) continue
    const other = branches.find((b) => b.type !== 'null')
    if (other && !other.$ref) return inlineBaseType(other, where)
  }
  throw new Error(`generate-contracts: ${where} has unsupported inline shape in a record`)
}
function goStructType(
  k: string,
  prop: JSchema,
  kind: 'input' | 'update' | 'record',
  parentId: string,
): string {
  const where = `${parentId}.${k}`
  const schema = targetOf(parentId, `struct ${parentId}`)
  const required = new Set(schema.required ?? [])
  const r = refOf(prop)
  if (r.id === null) {
    // Inline schemas are records-only (D11).
    if (kind !== 'record') {
      throw new Error(
        `generate-contracts: ${where} is inline — inputs must $ref a registered primitive/enum (D11)`,
      )
    }
    const base = inlineBaseType(prop, where)
    if ((r.nullable || !required.has(k)) && !base.startsWith('[]')) return `*${base}`
    return base
  }
  const base = goRefType({ id: r.id }, kind, k, where)
  if (kind === 'update') return `Optional[${base}]`
  if (kind === 'record') {
    if ((r.nullable || !required.has(k)) && !base.startsWith('[]')) return `*${base}`
    return base
  }
  // kind === 'input'
  if (!required.has(k) && r.def === undefined && !base.startsWith('[]') && base !== 'time.Time') {
    return `*${base}`
  }
  return base
}

function generateStruct(id: string, kind: 'input' | 'update' | 'record'): string {
  const schema = targetOf(id, `struct ${id}`)
  const props = schema.properties ?? {}
  const goNames = new Map<string, string>()
  let out = `type ${id} struct {\n`
  for (const [k, prop] of Object.entries(props)) {
    guardFieldName(k, `struct ${id}`, kind !== 'record')
    const goName = toPascalCase(k)
    const clash = goNames.get(goName)
    if (clash !== undefined) {
      throw new Error(
        `generate-contracts: ${id}.${k} and ${id}.${clash} both map to Go field "${goName}"`,
      )
    }
    goNames.set(goName, k)
    const goType = goStructType(k, prop, kind, id)
    const optional = !(schema.required ?? []).includes(k)
    const tag = kind === 'record' ? ` \`json:"${k}${optional ? ',omitempty' : ''}"\`` : ''
    out += `\t${goName} ${goType}${tag}\n`
  }
  out += '}\n'
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Generate apps/web/pkg/contracts/contracts_gen.go
// ─────────────────────────────────────────────────────────────────────────────

function generateGoContracts(): string {
  const localesSlice = contracts.LOCALES.map((l) => goString(l)).join(', ')

  // Enum types + consts for named Go enums (no x-go-type), in registration
  // order. Names come from x-go-enum-consts, values from the JSON Schema enum.
  const enumBlocks: string[] = []
  for (const [id] of Object.entries(WIRE_SCHEMAS)) {
    const meta = WIRE_META[id]
    if (meta?.kind !== 'enum' || meta['x-go-type']) continue
    const values = targetOf(id, `enum ${id}`).enum ?? []
    const consts = meta['x-go-enum-consts'] ?? {}
    const lines = values.map((v) => {
      const constName = consts[v]
      if (!constName) {
        throw new Error(
          `generate-contracts: enum ${id} value "${v}" has no x-go-enum-consts entry in wire.ts`,
        )
      }
      return `\t${constName} ${id} = ${goString(v)}`
    })
    enumBlocks.push(`type ${id} string\n\nconst (\n${lines.join('\n')}\n)\n`)
  }
  const enumDecls = enumBlocks.join('\n')

  // Dynamic structs from the wire registry (order = registration order in wire.ts, D12).
  const inputParts: string[] = []
  for (const [id] of Object.entries(WIRE_SCHEMAS)) {
    const kind = WIRE_META[id]?.kind
    if (kind !== 'input' && kind !== 'update') continue
    inputParts.push(generateStruct(id, kind))
  }
  const inputStructs = inputParts.join('\n')

  const recordStructs = Object.entries(WIRE_SCHEMAS)
    .filter(([id]) => WIRE_META[id]?.kind === 'record')
    .map(([id]) => generateStruct(id, 'record'))
    .join('\n')

  const recordNames = Object.entries(WIRE_SCHEMAS)
    .filter(([id]) => WIRE_META[id]?.kind === 'record')
    .map(([id]) => id)

  const routeSpecs = API_ROUTES.map(
    (r) =>
      `\t{OperationID: ${goString(r.operationId)}, Method: ${goString(r.method.toUpperCase())}, Path: ${goString(r.path)}},`,
  ).join('\n')

  const sessionCookies = contracts.SESSION_COOKIE_NAMES.map(goString).join(', ')

  const body = `// ── Shared Constants ────────────────────────────────────────────────────────
// Only what the Go side actually uses is emitted. Browser-only values (image
// decode limit, target sizes, WebP quality) and rule constants whose Go
// function is not ported stay in TypeScript — generating them here would be
// dead weight that can only drift.

// Demo account (ADR-010).
const (
	DemoOrganizerID       = ${goString(contracts.DEMO_ORGANIZER_ID)}
	DemoOrganizerSlug     = ${goString(contracts.DEMO_ORGANIZER_SLUG)}
	DemoReadOnlyCode      = ${goString(contracts.DEMO_READ_ONLY_CODE)}
	DemoReadOnlyMessage   = ${goString(contracts.DEMO_READ_ONLY_MESSAGE)}
	DemoServiceYoga       = ${goString(contracts.DEMO_SERVICE_IDS.yoga)}
	DemoServicePottery    = ${goString(contracts.DEMO_SERVICE_IDS.pottery)}
	DemoServiceBreathwork = ${goString(contracts.DEMO_SERVICE_IDS.breathwork)}
)

// QStash queues (ADR-012, architecture review fix #3).
const (
	QueueBookingCreated   = ${goString(contracts.QUEUE_BOOKING_CREATED)}
	QueueBookingCancelled = ${goString(contracts.QUEUE_BOOKING_CANCELLED)}
	QueueDemoRefresh      = ${goString(contracts.QUEUE_DEMO_REFRESH)}
	QueueOutboxSweep      = ${goString(contracts.QUEUE_OUTBOX_SWEEP)}
)

// One-time login links. The prefix is generated from the TS constant, so the
// Go writer and the TS reader cannot disagree on the Redis key.
const (
	LoginLinkTTLSeconds = ${contracts.LOGIN_LINK_TTL_S}
	LoginLinkKeyPrefix  = ${goString(contracts.LOGIN_LINK_KEY_PREFIX)}
)

// Slot validation tolerance.
const (
	SlotStartToleranceMS   = ${contracts.SLOT_START_TOLERANCE_MS}
	SlotStartInPastMessage = ${goString(contracts.SLOT_START_IN_PAST_MESSAGE)}
)

// ── Enums ────────────────────────────────────────────────────────────────────

${enumDecls}
// Locales — language switcher order.
var Locales = []string{${localesSlice}}

const DefaultLocale = ${goString(contracts.DEFAULT_LOCALE)}

// Auth.js session cookie names, https ("__Secure-"-prefixed, prod) first.
var SessionCookieNames = []string{${sessionCookies}}

// ── Request Input Structs ───────────────────────────────────────────────────

${inputStructs}

// ── Response DTOs & Records ─────────────────────────────────────────────────

${recordStructs}

var RecordNames = []string{${recordNames.map((n) => goString(n)).join(', ')}}

// ── API route manifest ──────────────────────────────────────────────────────

type RouteSpec struct {
	OperationID string
	Method      string
	Path        string
}

var APIRoutes = []RouteSpec{
${routeSpecs}
}
`
  // Imports derive from the emitted body: go build fails on a missing or
  // unused import, which is the check.
  const imports = body.includes('time.Time') ? '\t"time"\n' : ''
  return `// Generated from packages/contracts via scripts/generate-contracts.ts. Contains only derived code; hand-written rules live in rules.go / refine.go / domain.go.
package contracts

import (
${imports})

${body}`
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Generate apps/web/pkg/validation/validation_gen.go
// ─────────────────────────────────────────────────────────────────────────────

/** Length + int-range rules derived from JSON Schema constraints (A.1 order). */
function generateRules(): string {
  const parts: string[] = []
  for (const [id] of Object.entries(WIRE_SCHEMAS)) {
    const meta = metaOf(id, `rule ${id}`)
    if (meta.kind !== 'primitive' || meta['x-go-rule']) continue
    const t = targetOf(id, `rule ${id}`)
    if (t.type === 'string') {
      if (t.format !== undefined || t.pattern !== undefined) {
        throw new Error(
          `generate-contracts: primitive ${id} has format/pattern and no x-go-rule — refinements are hand-written (D10)`,
        )
      }
      if (t.minLength !== undefined && t.maxLength !== undefined) {
        parts.push(
          `func ${id}Rule(v string) string {\n\tif charLen(v) < ${t.minLength} {\n\t\treturn ${goString(zodMessages.stringTooSmall(t.minLength))}\n\t}\n\tif charLen(v) > ${t.maxLength} {\n\t\treturn ${goString(zodMessages.stringTooBig(t.maxLength))}\n\t}\n\treturn ""\n}\n`,
        )
      } else if (t.maxLength !== undefined) {
        parts.push(
          `func ${id}Rule(v string) string {\n\tif charLen(v) > ${t.maxLength} {\n\t\treturn ${goString(zodMessages.stringTooBig(t.maxLength))}\n\t}\n\treturn ""\n}\n`,
        )
      } else {
        throw new Error(
          `generate-contracts: primitive ${id} has no derivable length constraints and no x-go-rule`,
        )
      }
    }
  }
  const rangeVars: string[] = []
  for (const [id] of Object.entries(WIRE_SCHEMAS)) {
    const meta = metaOf(id, `rule ${id}`)
    if (meta.kind !== 'primitive' || meta['x-go-rule']) continue
    const t = targetOf(id, `rule ${id}`)
    if (t.type !== 'integer') continue
    if (t.exclusiveMinimum !== undefined || t.exclusiveMaximum !== undefined) {
      throw new Error(
        `generate-contracts: primitive ${id} has exclusive bounds and no x-go-rule (D10)`,
      )
    }
    if (t.minimum === undefined || t.maximum === undefined) {
      throw new Error(
        `generate-contracts: primitive ${id} has no derivable int bounds and no x-go-rule`,
      )
    }
    rangeVars.push(`\t${lowerFirst(id)}RangeRule = intRange(${t.minimum}, ${t.maximum})`)
  }
  parts.push(
    `// Pre-allocated range rules to eliminate per-request closure heap allocations.\nvar (\n${rangeVars.join('\n')}\n)\n`,
  )
  return parts.join('\n')
}

/** Enum rules for enums referenced by any input/update, in registration order. */
function generateEnumRules(): string {
  const referenced = new Set<string>()
  for (const [id] of Object.entries(WIRE_SCHEMAS)) {
    const meta = WIRE_META[id]
    if (meta?.kind !== 'input' && meta?.kind !== 'update') continue
    const s = targetOf(id, `enum refs of ${id}`)
    for (const [k, prop] of Object.entries(s.properties ?? {})) {
      const r = refOf(prop)
      if (r.id) {
        const rm = metaOf(r.id, `${id}.${k}`)
        if (rm.kind === 'enum') referenced.add(r.id)
      }
    }
  }
  const parts: string[] = []
  for (const [id] of Object.entries(WIRE_SCHEMAS)) {
    const meta = WIRE_META[id]
    if (meta?.kind !== 'enum' || !referenced.has(id)) continue
    const values = targetOf(id, `enum ${id}`).enum ?? []
    const cases = values.map((v) => goString(v)).join(', ')
    parts.push(
      `func ${id}Rule(v string) string {\n\tswitch v {\n\tcase ${cases}:\n\t\treturn ""\n\t}\n\treturn ${goString(zodMessages.enumOneOf(values))}\n}\n`,
    )
  }
  return parts.join('\n')
}

function orDefaultBlock(k: string, rule: string, def: unknown): string {
  return `func ${k}OrDefault(e *Errors, m map[string]json.RawMessage) string {\n\t${k}, _ := strValue(e, m, "${k}", false, false, ${rule})\n\tif ${k} == "" {\n\t\treturn ${goString(def as string)}\n\t}\n\treturn ${k}\n}\n`
}

function arrayElemRule(
  t: JSchema,
  where: string,
): { elemRule: string; elemTrim: boolean; max: number } {
  if (!t.items) throw new Error(`generate-contracts: ${where} array has no items`)
  const er = refOf(t.items)
  if (er.id === null) {
    throw new Error(
      `generate-contracts: ${where} is an array of inline items — array elements must $ref a registered string primitive so the element rule is derivable (D11)`,
    )
  }
  const emeta = metaOf(er.id, `${where} items`)
  const etarget = targetOf(er.id, `${where} items`)
  if (etarget.type !== 'string' || emeta.kind !== 'primitive') {
    throw new Error(
      `generate-contracts: ${where} is an array of ${er.id} — only []string fields are ported`,
    )
  }
  return {
    elemRule: emeta['x-go-rule'] ?? `${er.id}Rule`,
    elemTrim: emeta['x-go-trim'] === true,
    max: mustMaxItems(t, where),
  }
}

function mustMaxItems(t: JSchema, where: string): number {
  if (t.maxItems === undefined)
    throw new Error(`generate-contracts: ${where} array has no maxItems`)
  return t.maxItems
}

function stringRuleFor(refId: string, t: JSchema, where: string): { rule: string; trim: boolean } {
  const meta = metaOf(refId, where)
  if (t.format !== undefined || t.pattern !== undefined) {
    if (!meta['x-go-rule']) {
      throw new Error(
        `generate-contracts: primitive ${refId} in ${where} has format/pattern and no x-go-rule — refinements are hand-written (D10)`,
      )
    }
  }
  return { rule: meta['x-go-rule'] ?? `${refId}Rule`, trim: meta['x-go-trim'] === true }
}

function generateParser(id: string, kind: 'input' | 'update'): string {
  const schema = targetOf(id, `parser ${id}`)
  const props = schema.properties ?? {}
  const required = new Set(schema.required ?? [])
  const tsExport = lowerFirst(id)
  const L: string[] = []
  L.push(`// Parse${id} — port of ${tsExport}.`)
  L.push(`func Parse${id}(body []byte) (contracts.${id}, *Errors) {`)
  L.push(`\tm, e := rawObject(body)`)
  L.push(`\tif e != nil {`)
  L.push(`\t\treturn contracts.${id}{}, e`)
  L.push(`\t}`)
  L.push(`\te = NewErrors()`)
  L.push(`\tvar out contracts.${id}`)
  L.push(``)
  const helpers: string[] = []
  for (const [k, prop] of Object.entries(props)) {
    guardFieldName(k, `parser ${id}`)
    const Go = toPascalCase(k)
    const r = refOf(prop)
    if (r.id === null) {
      throw new Error(
        `generate-contracts: ${id}.${k} is inline — inputs must $ref a registered primitive/enum (D11)`,
      )
    }
    const t = targetOf(r.id, `${id}.${k}`)
    const meta = metaOf(r.id, `${id}.${k}`)
    if (meta.kind === 'record') {
      throw new Error(
        `generate-contracts: ${id}.${k} references record ${r.id} — inputs cannot nest records`,
      )
    }
    const req = required.has(k)
    if (kind === 'update') {
      if (meta.kind === 'enum' && (meta['x-go-type'] ?? r.id) !== 'string') {
        const enumGo = meta['x-go-type'] ?? r.id
        L.push(`\t${k} := optStr(e, m, "${k}", false, ${r.nullable}, ${r.id}Rule)`)
        L.push(`\tif ${k}.Set {`)
        L.push(`\t\tout.${Go}.Set = true`)
        L.push(`\t\tif ${k}.Value != nil {`)
        L.push(`\t\t\t${k}Typed := contracts.${enumGo}(*${k}.Value)`)
        L.push(`\t\tout.${Go}.Value = &${k}Typed`)
        L.push(`\t\t}`)
        L.push(`\t}`)
      } else if (t.type === 'string' || meta.kind === 'enum') {
        const { rule, trim } = stringRuleFor(r.id, t, `${id}.${k}`)
        L.push(`\tout.${Go} = optStr(e, m, "${k}", ${trim}, ${r.nullable}, ${rule})`)
      } else if (t.type === 'integer') {
        if (t.exclusiveMinimum !== undefined || t.exclusiveMaximum !== undefined) {
          if (!meta['x-go-rule'])
            throw new Error(
              `generate-contracts: ${id}.${k} has exclusive bounds and no x-go-rule (D10)`,
            )
        }
        L.push(
          `\tout.${Go} = optInt(e, m, "${k}", ${r.nullable}, ${meta['x-go-rule'] ?? `${lowerFirst(r.id)}RangeRule`})`,
        )
      } else if (t.type === 'array') {
        const { elemRule, elemTrim, max } = arrayElemRule(t, `${id}.${k}`)
        if (!elemTrim) {
          throw new Error(
            `generate-contracts: ${id}.${k} uses optStrArr which trims every element, but the element schema does not — use strArrValue or restore .trim()`,
          )
        }
        if (t.minItems !== undefined) {
          const parentMeta = metaOf(id, `parser ${id}`)
          if (!parentMeta['x-go-refine']) {
            throw new Error(
              `generate-contracts: ${id}.${k} array has minItems but ${id} has no x-go-refine — uniqueness/minimum live in refine.go`,
            )
          }
        }
        L.push(`\tout.${Go} = optStrArr(e, m, "${k}", ${r.nullable}, ${elemRule}, ${max})`)
      } else if (meta['x-go-type'] === 'FlexTime') {
        L.push(`\tout.${Go} = optFlexTime(e, m, "${k}", ${r.nullable}, nil)`)
      } else {
        throw new Error(`generate-contracts: ${id}.${k} has unsupported shape for an update field`)
      }
      continue
    }
    // kind === 'input'
    if (meta.kind === 'enum') {
      const enumGo = meta['x-go-type'] ?? r.id
      const rule = `${r.id}Rule`
      if (r.def !== undefined) {
        L.push(`\tout.${Go} = ${k}OrDefault(e, m)`)
        helpers.push(orDefaultBlock(k, rule, r.def))
      } else if (req) {
        if (enumGo !== 'string') {
          throw new Error(
            `generate-contracts: ${id}.${k} is a required named enum — no canonical form, add one consciously`,
          )
        }
        L.push(`\tout.${Go}, _ = strValue(e, m, "${k}", true, false, ${rule})`)
      } else {
        L.push(`\t${k}, _ := strValue(e, m, "${k}", false, false, ${rule})`)
        L.push(`\tif ${k} != "" {`)
        L.push(`\t\t${k}Typed := contracts.${enumGo}(${k})`)
        L.push(`\t\tout.${Go} = &${k}Typed`)
        L.push(`\t}`)
      }
      continue
    }
    if (meta['x-go-type'] === 'FlexTime') {
      L.push(`\t${k}, ${k}Present := flexTimeValue(e, m, "${k}", true, nil)`)
      L.push(`\tif ${k}Present {`)
      L.push(`\t\tout.${Go} = ${k}.Time()`)
      L.push(`\t}`)
      continue
    }
    if (t.type === 'string') {
      const { rule, trim } = stringRuleFor(r.id, t, `${id}.${k}`)
      if (r.def !== undefined) {
        L.push(`\tout.${Go} = ${k}OrDefault(e, m)`)
        helpers.push(orDefaultBlock(k, rule, r.def))
      } else if (req) {
        L.push(`\tout.${Go}, _ = strValue(e, m, "${k}", true, ${trim}, ${rule})`)
      } else {
        L.push(`\t${k}, ${k}Present := strValue(e, m, "${k}", false, ${trim}, ${rule})`)
        L.push(`\tif ${k}Present {`)
        L.push(`\t\tout.${Go} = &${k}`)
        L.push(`\t}`)
      }
      continue
    }
    if (t.type === 'integer') {
      if (t.exclusiveMinimum !== undefined || t.exclusiveMaximum !== undefined) {
        if (!meta['x-go-rule'])
          throw new Error(
            `generate-contracts: ${id}.${k} has exclusive bounds and no x-go-rule (D10)`,
          )
      }
      if (!req)
        throw new Error(
          `generate-contracts: ${id}.${k} is an optional input int — no canonical form, add one consciously`,
        )
      const rule = meta['x-go-rule'] ?? `${lowerFirst(r.id)}RangeRule`
      L.push(`\t${k}, _ := intValue(e, m, "${k}", true, ${rule})`)
      L.push(`\tout.${Go} = int(${k})`)
      continue
    }
    if (t.type === 'array') {
      const { elemRule, elemTrim, max } = arrayElemRule(t, `${id}.${k}`)
      if (t.minItems !== undefined) {
        const parentMeta = metaOf(id, `parser ${id}`)
        if (!parentMeta['x-go-refine']) {
          throw new Error(
            `generate-contracts: ${id}.${k} array has minItems but ${id} has no x-go-refine — uniqueness/minimum live in refine.go`,
          )
        }
      }
      L.push(`\tout.${Go}, _ = strArrValue(e, m, "${k}", ${req}, ${elemTrim}, ${elemRule}, ${max})`)
      continue
    }
    throw new Error(`generate-contracts: ${id}.${k} has unsupported shape for an input field`)
  }
  L.push(``)
  const refine = metaOf(id, `parser ${id}`)['x-go-refine']
  if (refine) L.push(`\t${refine}(e, &out)`)
  L.push(`\treturn out, e.Finish()`)
  L.push(`}`)
  let outText = L.join('\n') + '\n'
  for (const h of helpers) outText += '\n' + h
  return outText
}

function generateParsers(): string {
  const parts: string[] = []
  const names: string[] = []
  for (const [id] of Object.entries(WIRE_SCHEMAS)) {
    const kind = WIRE_META[id]?.kind
    if (kind !== 'input' && kind !== 'update') continue
    parts.push(generateParser(id, kind))
    names.push(`\t"${id}": func(b []byte) (any, *Errors) { return Parse${id}(b) },`)
  }
  return (
    parts.join('\n') +
    `\nvar Parsers = map[string]func([]byte) (any, *Errors){\n${names.join('\n')}\n}\n`
  )
}

function generateGoValidation(): string {
  const body = `// ── Patterns & reserved slugs ───────────────────────────────────────────────

var slugPattern = regexp.MustCompile(\`${goRegexSource(contracts.SLUG_PATTERN, 'SLUG_PATTERN')}\`)
var serviceIDPattern = regexp.MustCompile(\`${goRegexSource(contracts.SERVICE_ID_PATTERN, 'SERVICE_ID_PATTERN')}\`)

var reservedSlugs = map[string]bool{
${contracts.RESERVED_SLUGS.map((s) => `\t${goString(s)}: true,`).join('\n')}
}

// ── Derived length / int-range rules ────────────────────────────────────────

${generateRules()}
// ── Derived enum rules (A.2 order) ──────────────────────────────────────────

${generateEnumRules()}
// ── Parsers ─────────────────────────────────────────────────────────────────

${generateParsers()}
`
  // Imports derive from the emitted body: go build fails on a missing or
  // unused import, which is the check.
  const stdImports = [
    body.includes('json.') ? '\t"encoding/json"' : '',
    body.includes('regexp.') ? '\t"regexp"' : '',
  ].filter((line) => line !== '')
  const extImports = body.includes('contracts.') ? ['\t"countmein/pkg/contracts"'] : []
  const importBlock = [stdImports, extImports]
    .filter((group) => group.length > 0)
    .map((group) => group.join('\n'))
    .join('\n\n')
  return `// Generated from packages/contracts via scripts/generate-contracts.ts. Contains only derived code; hand-written rules live in rules.go / refine.go / domain.go.
package validation

import (
${importBlock}
)

${body}`
}

// Hand-written residue lives in ordinary Go files (rules.go / refine.go /
// domain.go), never in *_gen.go. The generator emits only calls and verifies
// the callee exists — a missing function fails generation, not the Go build.
function assertHandwrittenExists(goFile: string, funcName: string): void {
  const src = readFileSync(goFile, 'utf8')
  if (!src.includes(`func ${funcName}(`)) {
    throw new Error(
      `generate-contracts: ${funcName}() is called by the generated code but missing in ${goFile}`,
    )
  }
}

function assertResidueCallees(): void {
  const refineFile = join(webDir, 'pkg', 'validation', 'refine.go')
  for (const [id] of Object.entries(WIRE_SCHEMAS)) {
    const meta = WIRE_META[id]
    if (meta?.kind !== 'input' && meta?.kind !== 'update') continue
    const func = meta['x-go-refine']
    if (!func) continue
    // The emitter writes the `${func}(e, &out)` tail itself; re-grepping for
    // it would only compare the template against itself. What can actually
    // rot is the hand-written callee, and the refine behaviour is pinned by
    // packages/contracts/vectors/validation/* on both sides.
    assertHandwrittenExists(refineFile, func)
  }
  // x-go-rule callees live in rules.go.
  const rulesFile = join(webDir, 'pkg', 'validation', 'rules.go')
  for (const [id] of Object.entries(WIRE_SCHEMAS)) {
    const meta = WIRE_META[id]
    if (meta?.kind !== 'primitive') continue
    const rule = meta['x-go-rule']
    if (rule) assertHandwrittenExists(rulesFile, rule)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Generate apps/web/openapi.yaml
// ─────────────────────────────────────────────────────────────────────────────

function schemaRef(schema: unknown, where: string): { $ref: string } {
  const meta = metaOfSchema(schema as z.ZodType)
  if (!meta) {
    throw new Error(
      `generate-contracts: ${where} references a schema that is not registered in wire.ts`,
    )
  }
  return { $ref: `#/components/schemas/${meta.id}` }
}

function specVersion(schemas: Record<string, unknown>): string {
  const digest = createHash('sha256').update(JSON.stringify(schemas)).digest('hex')
  return `1.0.0+${digest.slice(0, 12)}`
}

function isLiteralEnum(schema: unknown): schema is { enum: readonly string[] } {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    'enum' in schema &&
    Array.isArray((schema as { enum: unknown }).enum) &&
    !('_zod' in schema)
  )
}

function generateOpenAPISpec(): string {
  const slugSchema = WIRE_SCHEMAS['Slug']
  const slugShapeSchema = WIRE_SCHEMAS['SlugShape']
  const slotStartsAtSchema = WIRE_SCHEMAS['SlotStartsAt']
  if (!slugSchema || !slugShapeSchema || !slotStartsAtSchema) {
    throw new Error(
      'generate-contracts: schemas "Slug", "SlugShape" and "SlotStartsAt" must stay registered in wire.ts — the OpenAPI override attaches to them',
    )
  }

  const openApiOverride = (ctx: { zodSchema: unknown; jsonSchema: Record<string, unknown> }) => {
    if ('$ref' in ctx.jsonSchema) return
    if (ctx.zodSchema === slugSchema || ctx.zodSchema === slugShapeSchema) {
      ctx.jsonSchema.pattern = contracts.SLUG_PATTERN.source
    }
    if (ctx.zodSchema === slotStartsAtSchema) {
      for (const key of Object.keys(ctx.jsonSchema)) delete ctx.jsonSchema[key]
      Object.assign(ctx.jsonSchema, {
        oneOf: [
          { type: 'string', format: 'date-time' },
          { type: 'integer', description: 'Unix epoch — seconds, or milliseconds when > 1e12.' },
        ],
        description: 'Date-only strings are rejected with 400.',
      })
    }
  }

  const render = (io: 'input' | 'output') =>
    (
      z.toJSONSchema(wire, {
        io,
        unrepresentable: 'any',
        uri: (id: string) => `#/components/schemas/${id}`,
        override: openApiOverride,
      }) as unknown as { schemas: Record<string, Record<string, unknown>> }
    ).schemas

  const inputSchemas = render('input')
  const outputSchemas = render('output')

  // Requests are what a client sends (pre-transform); records are what the API
  // returns (post-transform). Rendering both from one direction documents one
  // of them on the wrong side of every pipe.
  const directionFor = (id: string): Record<string, unknown> => {
    const kind = metaOf(id, `openapi ${id}`).kind
    return kind === 'record' ? outputSchemas[id]! : inputSchemas[id]!
  }

  const stripMeta = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(stripMeta)
    if (!node || typeof node !== 'object') return node
    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>)
        .filter(([k]) => k !== '$schema' && k !== '$id' && !k.startsWith('x-go-'))
        .map(([k, v]) => [k, stripMeta(v)]),
    )
  }

  const schemas: Record<string, unknown> = {}
  // Byte-order sort: localeCompare is ICU-dependent and can order the same
  // ids differently on another machine, producing a phantom CI diff.
  const byBytes = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
  for (const name of Object.keys(inputSchemas).sort(byBytes)) {
    const clean = stripMeta(directionFor(name)) as Record<string, unknown>
    schemas[name] = clean
  }

  // Neither direction is strict on the wire: Zod strips unknown request keys
  // and the Go parsers ignore them, while responses gain fields without a
  // version bump. `additionalProperties: false` would make a spec-validating
  // client reject traffic the API accepts in both directions.
  let stripped = 0
  for (const schema of Object.values(schemas) as Array<Record<string, unknown>>) {
    if (schema.additionalProperties === false) {
      delete schema.additionalProperties
      stripped++
    }
  }
  if (stripped === 0) {
    throw new Error(
      'generate-contracts: no additionalProperties:false was emitted — the strip is now dead code; drop it or fix the render direction',
    )
  }

  const paths: Record<string, Record<string, unknown>> = {}
  for (const route of API_ROUTES) {
    const operation: Record<string, unknown> = {
      summary: route.summary,
      operationId: route.operationId,
    }
    if (route.auth === 'sessionWritable' || route.auth === 'sessionOrDemoRead') {
      operation.security = [{ sessionCookie: [] }]
    }
    if (route.params?.length) {
      operation.parameters = route.params.map((p) => ({
        name: p.name,
        in: p.in,
        required: p.required,
        schema: isLiteralEnum(p.schema)
          ? { type: 'string', enum: [...p.schema.enum] }
          : schemaRef(p.schema, `${route.operationId}.${p.name}`),
        ...(p.description ? { description: p.description } : {}),
      }))
    }
    if (route.request) {
      operation.requestBody = {
        required: true,
        content: {
          'application/json': { schema: schemaRef(route.request, `${route.operationId} request`) },
        },
      }
    }
    operation.responses = Object.fromEntries(
      route.responses.map((response) => {
        const body = response.bodyOneOf
          ? {
              oneOf: response.bodyOneOf.map((s) =>
                schemaRef(s, `${route.operationId} ${response.status}`),
              ),
            }
          : response.body
            ? schemaRef(response.body, `${route.operationId} ${response.status}`)
            : undefined
        return [
          String(response.status),
          body
            ? {
                description: response.description,
                content: { 'application/json': { schema: body } },
              }
            : { description: response.description },
        ]
      }),
    )
    paths[route.path] = { ...(paths[route.path] ?? {}), [route.method]: operation }
  }

  // demo.refresh delivers an empty body, which no Zod schema describes — the
  // only requestBody in the API that is not a single registered schema.
  const runJob = paths['/api/jobs/{queue}']?.post as Record<string, unknown> | undefined
  if (!runJob) {
    throw new Error('generate-contracts: the jobs receiver is missing from API_ROUTES')
  }
  runJob.requestBody = {
    required: true,
    content: {
      'application/json': {
        schema: {
          oneOf: [
            { $ref: '#/components/schemas/BookingCreatedJob' },
            { $ref: '#/components/schemas/BookingCancelledJob' },
            { type: 'object', description: 'demo.refresh carries no payload' },
          ],
        },
      },
    },
  }

  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'CountMeIn API',
      description: 'API for group booking, organizer cabinet management, and notifications.',
      version: specVersion(schemas),
    },
    servers: [
      { url: 'https://countmein.group', description: 'Production' },
      { url: 'http://localhost:3000', description: 'Local development' },
    ],
    paths,
    // Redis JSON payloads never appear as HTTP bodies; they still travel as
    // JSON between the API and Redis, so they are part of the wire. Pinning
    // them here keeps the orphan-schema check honest without inventing fake
    // HTTP operations.
    'x-internal': INTERNAL_RECORDS.map((s, i) => schemaRef(s, `internal[${i}]`)),
    components: {
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: contracts.SESSION_COOKIE_NAMES[0],
          description: `Auth.js session cookie: \`${contracts.SESSION_COOKIE_NAMES[0]}\` in production, \`${contracts.SESSION_COOKIE_NAMES[1]}\` in local development.`,
        },
      },
      schemas,
    },
  }

  assertOpenApiSpec(spec)
  const text = yaml.stringify(spec, { indent: 2 })
  if (text.includes('x-go-')) {
    throw new Error(
      'generate-contracts: x-go-* metadata leaked into openapi.yaml — strip it before writing',
    )
  }
  return text
}

/**
 * Structural sanity check for the emitted spec. CI only diffs the file for
 * freshness, so without this a dangling `$ref` or an operation without
 * responses would be committed and only noticed by a spec consumer.
 */
function assertOpenApiSpec(spec: unknown): void {
  const root = spec as {
    openapi?: string
    paths?: Record<string, Record<string, unknown>>
    components?: Record<string, Record<string, unknown>>
  }
  if (root.openapi !== '3.1.0') {
    throw new Error(`generate-contracts: unexpected OpenAPI version "${root.openapi ?? 'none'}"`)
  }
  const components = root.components ?? {}
  const schemaNames = new Set(Object.keys(components.schemas ?? {}))
  if (schemaNames.size === 0) {
    throw new Error('generate-contracts: OpenAPI spec has no component schemas')
  }

  const refs: string[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (!node || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') refs.push(value)
      else walk(value)
    }
  }
  walk(root)

  for (const ref of refs) {
    const match = /^#\/components\/([^/]+)\/(.+)$/.exec(ref)
    if (!match) {
      throw new Error(
        `generate-contracts: unsupported OpenAPI $ref "${ref}" — only #/components sections are referenced`,
      )
    }
    const [, section, name] = match
    if (!Object.keys(components[section!] ?? {}).includes(name!)) {
      throw new Error(
        `generate-contracts: dangling OpenAPI $ref "${ref}" — component is not emitted`,
      )
    }
  }

  // Reverse direction: a component nothing references is a schema that never
  // reaches the wire — either a path is missing from API_ROUTES or the schema
  // should not be registered.
  const referenced = new Set(
    refs
      .map((ref) => /^#\/components\/schemas\/(.+)$/.exec(ref)?.[1])
      .filter((name): name is string => name !== undefined),
  )
  const reachable = new Set<string>()
  const visit = (name: string): void => {
    if (reachable.has(name)) return
    reachable.add(name)
    const nested: string[] = []
    const collect = (node: unknown): void => {
      if (Array.isArray(node)) return void node.forEach(collect)
      if (!node || typeof node !== 'object') return
      for (const [key, value] of Object.entries(node)) {
        if (key === '$ref' && typeof value === 'string') {
          const m = /^#\/components\/schemas\/(.+)$/.exec(value)
          if (m?.[1]) nested.push(m[1])
        } else collect(value)
      }
    }
    collect((components.schemas ?? {})[name])
    nested.forEach(visit)
  }
  referenced.forEach(visit)

  const orphans = [...schemaNames].filter((name) => !reachable.has(name)).sort()
  if (orphans.length > 0) {
    throw new Error(
      `generate-contracts: component schemas reachable from no operation: ${orphans.join(', ')} — add the route to packages/contracts/src/routes.ts or unregister the schema`,
    )
  }

  const methods = new Set(['get', 'post', 'put', 'patch', 'delete'])
  for (const [path, item] of Object.entries(root.paths ?? {})) {
    const operations = Object.entries(item).filter(([m]) => methods.has(m))
    if (operations.length === 0) {
      throw new Error(`generate-contracts: OpenAPI path "${path}" documents no operations`)
    }
    for (const [method, operation] of operations) {
      const responses = (operation as { responses?: unknown }).responses
      if (!responses || typeof responses !== 'object' || Object.keys(responses).length === 0) {
        throw new Error(
          `generate-contracts: OpenAPI ${method.toUpperCase()} ${path} documents no responses`,
        )
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution
// ─────────────────────────────────────────────────────────────────────────────

function main(): void {
  // Compute every artifact before writing any: a failure leaves the tree
  // untouched instead of half-regenerated.
  const goContracts = generateGoContracts()

  // The emitters resolve every field by $ref and throw on anything they
  // cannot derive (D10/D11); a schema edit the emitter cannot handle fails
  // here, not as a silent zero value.
  const goValidation = generateGoValidation()
  assertResidueCallees()

  const openapiYaml = generateOpenAPISpec()

  writeFileSync(goContractsFile, goContracts, 'utf8')
  console.log(`Wrote ${goContractsFile}`)
  writeFileSync(goValidationFile, goValidation, 'utf8')
  console.log(`Wrote ${goValidationFile}`)

  // Format Go files
  try {
    execSync(`gofmt -w "${goContractsFile}" "${goValidationFile}"`, { stdio: 'inherit' })
  } catch {
    console.warn(
      'Warning: gofmt failed or is not available — generated Go files are unformatted; CI gofmt check will fail.',
    )
  }

  writeFileSync(openapiFile, openapiYaml, 'utf8')
  console.log(`Wrote ${openapiFile}`)

  console.log('Contract generation complete.')
}

main()
