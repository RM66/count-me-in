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
const specJsonFile = join(__dirname, '..', 'api', '_lib', 'countmein', 'contracts', 'spec_gen.json')

const document = buildOpenApiDocument()

writeFileSync(specFile, yaml.stringify(document, { indent: 2 }), 'utf8')
console.log(`Wrote ${specFile}`)

// The same document as JSON for the Python runtime (ADR-024): the API
// validates against this bundled copy, so the deployed bundle never
// depends on openapi.yaml being present or on a YAML parser.
writeFileSync(specJsonFile, JSON.stringify(document, null, 2) + '\n', 'utf8')
console.log(`Wrote ${specJsonFile}`)
