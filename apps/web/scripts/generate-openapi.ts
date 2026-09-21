/**
 * Writes the OpenAPI spec from the Zod wire registry via zod-openapi
 * (ADR-016). Since oapi-codegen v2.8.0 supports OpenAPI 3.1, one document
 * serves both consumers: it is committed at `apps/web/openapi.yaml` —
 * the public spec and the Go toolchain's input (`go generate` reads it
 * via the relative path in pkg/api/gen/doc.go; oapi-codegen embeds it
 * into spec_gen.go).
 *
 * The document itself is built in `@repo/contracts/openapi`; this script
 * only renders it to YAML. Dangling `$ref`s and orphan schemas are caught
 * by zod-openapi itself (and by oapi-codegen, which fails on an unresolved
 * `$ref`).
 *
 * Run via: `bun run generate:openapi`
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildOpenApiDocument } from '@repo/contracts/openapi'
import yaml from 'yaml'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const specFile = join(__dirname, '..', 'openapi.yaml')

const text = yaml.stringify(buildOpenApiDocument(), { indent: 2 })
if (text.includes('x-go-')) {
  throw new Error(
    'generate-openapi: x-go-* metadata leaked into the spec — strip it before writing',
  )
}

writeFileSync(specFile, text, 'utf8')
console.log(`Wrote ${specFile}`)
