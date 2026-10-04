import { nextJsConfig } from '@repo/eslint-config/next-js'

/**
 * `countmein/no-untranslated-strings` is enabled app-wide (ADR-011).
 *
 * No directory list is needed: the rule inspects JSX nodes plus the few
 * non-JSX shapes that carry copy — toast calls, `ApiError` fallbacks and
 * `NextResponse.json({ error })` bodies — so files without UI produce no
 * reports on their own. Tests and Storybook stories are exempt: story
 * fixtures are development-only and tests assert copy deliberately.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export default [
  ...nextJsConfig,
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.*', '**/*.stories.*'],
    rules: {
      'countmein/no-untranslated-strings': 'error',
    },
  },
  {
    // Component props are always `type` (any declaration named `*Props`).
    // Lives here, not in the shared base config: React components exist only
    // in this app. Other object shapes are the author's choice — `interface`
    // stays legal for plain object shapes and remains required in ambient
    // declarations (`**/*.d.ts`), where declaration merging needs it.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSInterfaceDeclaration[id.name=/Props$/]',
          message: 'Component props use `type Props = { ... }`, never `interface`.',
        },
      ],
    },
  },
  {
    // Architectural guard (ADR-021/022): app code has
    // ZERO direct Postgres access — every server read goes through
    // src/server/api-client.ts over HTTP to the Python API. Forbid DB
    // driver imports so the seam cannot silently re-open. The single
    // exception is e2e/, whose fixtures own the test precondition
    // (seed rows, Redis tickets) — they are test infrastructure, not app
    // code, and cannot be expressed through the wire API.
    files: ['**/*.{ts,tsx}'],
    ignores: ['e2e/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'pg',
              message:
                'No direct Postgres access outside e2e/ — server reads go through src/server/api-client.ts over HTTP to the Python API.',
            },
            {
              name: 'postgres',
              message:
                'No direct Postgres access outside e2e/ — server reads go through src/server/api-client.ts over HTTP to the Python API.',
            },
            {
              name: 'drizzle-orm',
              message:
                'No direct Postgres access outside e2e/ — server reads go through src/server/api-client.ts over HTTP to the Python API.',
            },
          ],
          patterns: [
            {
              group: ['drizzle-orm/*', '@repo/db', '@repo/db/*', '**/server/db/**'],
              message:
                'No direct Postgres access outside e2e/ — server reads go through src/server/api-client.ts over HTTP to the Python API.',
            },
          ],
        },
      ],
    },
  },
]
