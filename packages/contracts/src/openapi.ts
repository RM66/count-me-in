/**
 * The OpenAPI document, built from the wire registry (ADR-016).
 *
 * Zod stays the single source of truth: component schemas come from
 * [`wire.ts`](./wire.ts) (every registered schema becomes a component, id =
 * wire id), and paths are ported 1:1 from the route table in
 * [`routes.ts`](./routes.ts) — method, path, auth → `security`, rateLimit →
 * `x-rateLimit`, `internal: true` registrations → `x-internal`.
 *
 * Render directions follow usage, which matches the old generator's rule:
 * request bodies are rendered with `io: 'input'` (what a client sends),
 * everything else falls back to the `io: 'output'` render (what the API
 * returns). Schemas used in both directions keep one component because the
 * document is generated with `outputIdSuffix: ''`.
 *
 * One override lives here as a document-level `override` hook (it must not
 * become `.meta()` on the shared schema objects — that would write into
 * Zod's global registry and leak into every other `z.toJSONSchema`
 * consumer):
 * - `SlotStartsAt` — the union of RFC 3339 string / epoch / Date renders
 *   more precisely as the wire's actual contract: an ISO string **or** a
 *   Unix epoch (FlexTime on the API side), which only `oneOf` can say.
 *
 * Build-time only: imports `node:crypto` and the full wire registry. Not
 * re-exported from `index.ts` — import via `@repo/contracts/openapi`.
 */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { createDocument, type ZodOpenApiOverride } from 'zod-openapi'

import { SESSION_COOKIE_NAMES } from './auth'
import { JOB_QUEUES } from './jobs'
import { API_ROUTES } from './routes'
import { metaOfSchema, WIRE_META, WIRE_SCHEMAS } from './wire'

const slotStartsAtSchema = WIRE_SCHEMAS['SlotStartsAt']
if (!slotStartsAtSchema) {
  throw new Error(
    'openapi: schema "SlotStartsAt" must stay registered in wire.ts — the OpenAPI override attaches to it',
  )
}

/**
 * The override hook types the visited schema as zod/v4-core's `$ZodTypes`,
 * a different class than the `z.ZodType` in the registry — object identity
 * is the only comparison that works, so narrow through `unknown`.
 */
function isSchema(zodSchema: unknown, candidate: unknown): boolean {
  return zodSchema === candidate
}

/**
 * Document-level render overrides, applied in both io directions. See the
 * module doc for why these live here instead of as `.meta()` on the schemas.
 */
const openApiOverride: ZodOpenApiOverride = (ctx) => {
  if ('$ref' in ctx.jsonSchema) return
  if (isSchema(ctx.zodSchema, slotStartsAtSchema)) {
    for (const key of Object.keys(ctx.jsonSchema)) delete ctx.jsonSchema[key]
    Object.assign(ctx.jsonSchema, {
      oneOf: [
        { type: 'string', format: 'date-time' },
        {
          type: 'integer',
          format: 'int64',
          description: 'Unix epoch — seconds, or milliseconds when > 1e12.',
        },
      ],
      description: 'Date-only strings are rejected with 400.',
    })
  }
}

/** `$ref` for a registered wire schema; a typo in routes.ts fails here, not in a consumer. */
function schemaRef(schema: z.ZodType, where: string): { $ref: string } {
  const meta = metaOfSchema(schema)
  if (!meta) {
    throw new Error(`openapi: ${where} references a schema that is not registered in wire.ts`)
  }
  return { $ref: `#/components/schemas/${meta.id}` }
}

/**
 * An ad-hoc `{ enum: [...] }` param literal vs a real Zod schema: identity by
 * class, not by duck-typing internals (`_zod`), which move between versions.
 */
function isLiteralEnum(schema: z.ZodType | { enum: readonly string[] }): schema is {
  enum: readonly string[]
} {
  return !(schema instanceof z.ZodType)
}

/** Byte-order sort: localeCompare is ICU-dependent and can order the same ids differently on another machine. */
const byBytes = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Neither direction is strict on the wire: Zod strips unknown request keys
 * and the API's decoders ignore them, while responses gain fields without
 * a version bump. `additionalProperties: false` (emitted by Zod for output
 * renders) would make a spec-validating client reject traffic the API
 * accepts.
 */
function stripAdditionalPropertiesFalse(schemas: Record<string, Record<string, unknown>>): number {
  let stripped = 0
  for (const schema of Object.values(schemas)) {
    if (schema.additionalProperties === false) {
      delete schema.additionalProperties
      stripped++
    }
  }
  if (stripped === 0) {
    throw new Error(
      'openapi: no additionalProperties:false was emitted — the strip is now dead code; drop it or fix the render direction',
    )
  }
  return stripped
}

/**
 * Spec version from a hash of the whole rendered document (minus the version
 * itself), so any semantic change — paths, schemas, security schemes,
 * x-internal records — moves it.
 */
function specVersion(document: Record<string, unknown>): string {
  const docSansVersion = JSON.parse(JSON.stringify(document)) as Record<string, unknown>
  delete (docSansVersion.info as Record<string, unknown>).version
  const digest = createHash('sha256').update(JSON.stringify(docSansVersion)).digest('hex')
  return `1.0.0+${digest.slice(0, 12)}`
}

/** Paths ported 1:1 from the route table: auth → security, rateLimit → x-rateLimit. */
function buildPaths(): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {}
  const seenOperations = new Set<string>()
  for (const route of API_ROUTES) {
    const opKey = `${route.method} ${route.path}`
    if (seenOperations.has(opKey)) {
      throw new Error(`openapi: duplicate operation ${opKey} in API_ROUTES`)
    }
    seenOperations.add(opKey)
    const operation: Record<string, unknown> = {
      summary: route.summary,
      operationId: route.operationId,
    }
    if (route.auth === 'sessionWritable' || route.auth === 'sessionOrDemoRead') {
      operation.security = [{ sessionCookie: [] }]
    } else if (route.auth === 'internal') {
      operation.security = [{ internalSecret: [] }]
    }
    if (route.rateLimit) {
      // The 429 response is hand-declared per route; this carries the numbers
      // themselves so the spec documents the limit, not just the status.
      operation['x-rateLimit'] = {
        limit: route.rateLimit.limit,
        windowSeconds: route.rateLimit.windowSeconds,
        per: route.rateLimit.per,
      }
    }
    if (route.params?.length) {
      operation.parameters = route.params.map((p) => ({
        name: p.name,
        in: p.in,
        required: p.required,
        schema: isLiteralEnum(p.schema)
          ? { type: 'string', enum: [...p.schema.enum] }
          : schemaRef(p.schema as z.ZodType, `${route.operationId}.${p.name}`),
        ...(p.description ? { description: p.description } : {}),
      }))
    }
    if (route.request) {
      // The Zod instance (not a $ref) so the library renders the request
      // body on the input side of the pipe and marks the schema input-used.
      // The three partial-update endpoints declare merge-patch (RFC 7386,
      // ADR-016): absent key = keep, explicit null = clear.
      operation.requestBody = {
        required: true,
        content: {
          [route.requestContentType ?? 'application/json']: { schema: route.request },
        },
      }
    }
    operation.responses = Object.fromEntries(
      route.responses.map((response) => {
        const body = response.bodyAnyOf
          ? {
              // anyOf, not oneOf: the validation envelope is an ErrorBody
              // superset (error + code + details), so a body can satisfy
              // more than one declared shape.
              anyOf: response.bodyAnyOf.map((s) =>
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

  // The jobs receiver is the only requestBody that is not a single
  // registered schema: JOB_QUEUES maps each queue to its payload schema,
  // and the schedules that carry none post an empty body.
  const runJob = paths['/api/jobs/{queue}']?.post as Record<string, unknown> | undefined
  if (!runJob) {
    throw new Error('openapi: the jobs receiver is missing from API_ROUTES')
  }
  const jobPayloads: { $ref: string }[] = []
  const emptyQueues: string[] = []
  for (const [queue, payload] of Object.entries(JOB_QUEUES)) {
    if (payload === null) emptyQueues.push(queue)
    else jobPayloads.push(schemaRef(payload, `runJob ${queue}`))
  }
  runJob.requestBody = {
    required: true,
    content: {
      'application/json': {
        schema: {
          oneOf: [
            ...jobPayloads,
            ...(emptyQueues.length > 0
              ? [
                  {
                    type: 'object',
                    maxProperties: 0,
                    description: `${new Intl.ListFormat('en', { type: 'conjunction' }).format(emptyQueues)} carry no payload`,
                  },
                ]
              : []),
          ],
        },
      },
    },
  }
  return paths
}

/**
 * The complete OpenAPI 3.1 document. Deterministic: same wire registry and
 * route table always produce the same YAML (component schemas sorted by
 * byte order, version derived from the content hash).
 *
 * One document serves both the committed public spec and the Python
 * toolchain (datamodel-code-generator + the spec decode) — the former
 * 3.0.3 down-render is gone.
 */
const API_INFO = {
  title: 'CountMeIn API',
  description: 'API for group booking, organizer cabinet management, and notifications.',
}
const API_SERVERS = [
  { url: 'https://countmein.group', description: 'Production' },
  { url: 'http://localhost:3000', description: 'Local development' },
]

export function buildOpenApiDocument(): Record<string, unknown> {
  if (SESSION_COOKIE_NAMES.length < 2) {
    throw new Error('openapi: SESSION_COOKIE_NAMES must list the https and http cookie names')
  }

  // Redis JSON payloads never appear as HTTP bodies; they still travel as
  // JSON between the API and Redis, so they are part of the wire.
  const xInternal = Object.entries(WIRE_META)
    .filter(([, meta]) => meta.internal === true)
    .map(([id]) => ({ $ref: `#/components/schemas/${id}` }))
  const securitySchemes = {
    sessionCookie: {
      type: 'apiKey',
      in: 'cookie',
      name: SESSION_COOKIE_NAMES[0],
      description: `Auth.js session cookie: \`${SESSION_COOKIE_NAMES[0]}\` in production, \`${SESSION_COOKIE_NAMES[1]}\` in local development.`,
    },
    internalSecret: {
      type: 'apiKey',
      in: 'header',
      name: 'x-internal-secret',
      description:
        'Internal secret header for service-to-service communication between Next.js BFF and Python API.',
    },
  } as const

  const document = createDocument(
    {
      openapi: '3.1.0',
      info: { ...API_INFO, version: '0.0.0' }, // replaced by the content hash below
      servers: API_SERVERS,
      paths: buildPaths(),
      'x-internal': xInternal,
      components: {
        schemas: WIRE_SCHEMAS as Record<string, z.ZodType>,
        securitySchemes,
      },
    },
    {
      override: openApiOverride,
      // Schemas used in both io directions keep a single component named by
      // the wire id (the default 'Output' suffix would duplicate them).
      outputIdSuffix: '',
    },
  ) as unknown as {
    paths: Record<string, Record<string, unknown>>
    components: {
      schemas: Record<string, Record<string, unknown>>
    }
  }

  const schemas = Object.fromEntries(
    Object.entries(document.components.schemas).sort(([a], [b]) => byBytes(a, b)),
  )
  stripAdditionalPropertiesFalse(schemas)

  const paths = document.paths
  const runJob = paths['/api/jobs/{queue}']?.post as Record<string, unknown> | undefined
  if (!runJob?.requestBody) {
    throw new Error('openapi: the jobs receiver lost its requestBody')
  }
  const result = {
    openapi: '3.1.0',
    info: { ...API_INFO, version: '' }, // filled below
    servers: API_SERVERS,
    paths,
    'x-internal': xInternal,
    components: {
      securitySchemes,
      schemas,
    },
  }
  return { ...result, info: { ...API_INFO, version: specVersion(result) } }
}
