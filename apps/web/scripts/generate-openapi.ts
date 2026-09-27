/**
 * Writes the OpenAPI spec from the Zod wire registry via zod-openapi
 * (ADR-016). Since the Python toolchain (datamodel-code-generator)
 * supports OpenAPI 3.1, one document
 * serves both consumers: it is committed at `apps/web/openapi.yaml` —
 * the public spec and the Python toolchain's input
 * (datamodel-code-generator reads it into models_gen.py).
 *
 * The document itself is built in `@repo/contracts/openapi`; this script
 * only renders it to YAML. Dangling `$ref`s and orphan schemas are caught
 * by zod-openapi itself (and by the Python codegen, which fails on an
 * unresolved
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
