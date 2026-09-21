import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WIRE_SCHEMAS } from '@repo/contracts/wire'
import { describe, expect, it } from 'vitest'

const dir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'pkg',
  'contracts',
  'testdata',
  'golden',
)

describe('golden records parse under their Zod schemas', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  expect(files.length).toBeGreaterThan(0)
  for (const file of files) {
    it(file, () => {
      const id = file.split('.')[0] as string
      const schema = WIRE_SCHEMAS[id]
      expect(schema, `no wire schema for golden ${file}`).toBeDefined()
      const result = schema!.safeParse(JSON.parse(readFileSync(join(dir, file), 'utf8')))
      expect(
        result.success,
        result.success ? '' : JSON.stringify(result.error.issues).slice(0, 2000),
      ).toBe(true)
    })
  }
})
