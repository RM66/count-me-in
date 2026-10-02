/**
 * Generate the Python translation dictionary from `packages/translations`.
 *
 * The i18n generator for the Python API: it only needs two slices of the
 * full corpus —
 *   - all of `api-errors/*.json` (route error copy)
 *   - all of `notifications/*.json` (Telegram bot copy)
 * — compiled directly into dict literals in
 *   `api/_lib/countmein/i18n/translations_gen.py` (no runtime JSON parsing,
 *   no drift). Run via `bun run generate:i18n:py`.
 *
 * The generated file is committed (Vercel builds need no pre-step) and CI
 * verifies freshness with `git diff --exit-code`.
 */
import { execSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_LOCALE, LOCALES } from '@repo/contracts'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const rootDir = join(__dirname, '..', '..', '..')
const apiErrorsDir = join(rootDir, 'packages', 'translations', 'api-errors')
const notificationsDir = join(rootDir, 'packages', 'translations', 'notifications')
const targetFile = join(__dirname, '..', 'api', '_lib', 'countmein', 'i18n', 'translations_gen.py')

/** Escape a string as a Python double-quoted string literal. */
function pyString(str: string): string {
  // JSON string escaping (\n, \", \\, \uXXXX) is a valid Python subset for
  // the ICU message corpus (no raw control characters reach this path).
  return JSON.stringify(str)
}

/**
 * Read `{locale}.json` from `dir`. Fails loudly on a missing file and on
 * nested values — both dictionaries are flat key → ICU string maps, and a
 * non-string leaf would otherwise be silently dropped from the Python side.
 */
function readDictionary(dir: string, locale: string): Record<string, unknown> {
  const file = join(dir, `${locale}.json`)
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
}

function flatStrings(dir: string, locale: string, node: Record<string, unknown>): Record<string, string> {
  const map: Record<string, string> = {}
  for (const [key, val] of Object.entries(node)) {
    if (typeof val !== 'string') {
      throw new Error(`${dir.split('/').pop()}/${locale}.json: key "${key}" is not a string`)
    }
    map[key] = val
  }
  return map
}

/** The on-disk file set must be exactly LOCALES — no more, no less. */
function assertLocaleSet(dir: string): void {
  const onDisk = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''))
    .sort()
  const expected = [...LOCALES].sort()
  if (JSON.stringify(onDisk) !== JSON.stringify(expected)) {
    throw new Error(
      `${dir}: files [${onDisk.join(', ')}] do not match LOCALES [${expected.join(', ')}]`,
    )
  }
}

function generate(): void {
  assertLocaleSet(apiErrorsDir)
  assertLocaleSet(notificationsDir)
  const locales = LOCALES

  const apiErrorsByLocale: Record<string, Record<string, string>> = {}
  const notificationsByLocale: Record<
    string,
    { top: Record<string, string>; sections: Record<string, Record<string, string>> }
  > = {}

  for (const locale of locales) {
    // 1. api-errors/<locale>.json — a flat key → message map.
    apiErrorsByLocale[locale] = flatStrings(
      apiErrorsDir,
      locale,
      readDictionary(apiErrorsDir, locale),
    )

    // 2. notifications/<locale>.json — top-level strings + nested sections.
    const notifContent = readDictionary(notificationsDir, locale)
    const topMap: Record<string, string> = {}
    const sectionsMap: Record<string, Record<string, string>> = {}

    for (const [section, val] of Object.entries(notifContent)) {
      if (typeof val === 'string') {
        topMap[section] = val
      } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        sectionsMap[section] = flatStrings(
          notificationsDir,
          locale,
          val as Record<string, unknown>,
        )
      } else {
        throw new Error(`notifications/${locale}.json: key "${section}" has an unsupported shape`)
      }
    }
    notificationsByLocale[locale] = { top: topMap, sections: sectionsMap }
  }

  // Shape parity guard: `en` defines the corpus shape (ADR-011); a locale
  // missing a key would silently fall back to English at runtime. Fail the
  // generation instead, so the gap is fixed at the source.
  const enErrors = apiErrorsByLocale[DEFAULT_LOCALE] ?? {}
  const enNotifs = notificationsByLocale[DEFAULT_LOCALE] ?? { top: {}, sections: {} }
  for (const locale of locales) {
    const errs = apiErrorsByLocale[locale] ?? {}
    for (const key of Object.keys(enErrors)) {
      if (!(key in errs)) {
        throw new Error(
          `api-errors/${locale}.json: missing key "${key}" (present in ${DEFAULT_LOCALE})`,
        )
      }
    }
    const notifs = notificationsByLocale[locale] ?? { top: {}, sections: {} }
    for (const key of Object.keys(enNotifs.top)) {
      if (!(key in notifs.top)) {
        throw new Error(
          `notifications/${locale}.json: missing top-level key "${key}" (present in ${DEFAULT_LOCALE})`,
        )
      }
    }
    for (const [section, keys] of Object.entries(enNotifs.sections)) {
      const local = notifs.sections[section] ?? {}
      for (const key of Object.keys(keys)) {
        if (!(key in local)) {
          throw new Error(
            `notifications/${locale}.json: section "${section}" is missing key "${key}" (present in ${DEFAULT_LOCALE})`,
          )
        }
      }
    }
  }

  // Generate Python source.
  let code = `# Code generated by scripts/generate-i18n-py.ts; DO NOT EDIT.
# Locale -> key -> ICU message. \`en\` defines the shape (ADR-011).

API_ERRORS: dict[str, dict[str, str]] = {
`

  for (const locale of locales) {
    code += `    ${pyString(locale)}: {\n`
    const errMap = apiErrorsByLocale[locale]!
    for (const k of Object.keys(errMap).sort()) {
      code += `        ${pyString(k)}: ${pyString(errMap[k]!)},\n`
    }
    code += '    },\n'
  }
  code += '}\n\n'

  code += 'NOTIFICATIONS_TOP: dict[str, dict[str, str]] = {\n'
  for (const locale of locales) {
    const dict = notificationsByLocale[locale]!
    code += `    ${pyString(locale)}: {\n`
    for (const k of Object.keys(dict.top).sort()) {
      code += `        ${pyString(k)}: ${pyString(dict.top[k]!)},\n`
    }
    code += '    },\n'
  }
  code += '}\n\n'

  code += 'NOTIFICATIONS_SECTIONS: dict[str, dict[str, dict[str, str]]] = {\n'
  for (const locale of locales) {
    const dict = notificationsByLocale[locale]!
    code += `    ${pyString(locale)}: {\n`
    for (const sec of Object.keys(dict.sections).sort()) {
      code += `        ${pyString(sec)}: {\n`
      const flat = dict.sections[sec]!
      for (const k of Object.keys(flat).sort()) {
        code += `            ${pyString(k)}: ${pyString(flat[k]!)},\n`
      }
      code += '        },\n'
    }
    code += '    },\n'
  }
  code += '}\n'

  writeFileSync(targetFile, code, 'utf8')
  try {
    execSync(`uv run ruff format "${targetFile}"`, { stdio: 'inherit' })
  } catch {
    // If ruff is unavailable in the current environment, leave the file as-is.
  }
  console.log(`Generated Python translations at ${targetFile}`)
}

generate()
