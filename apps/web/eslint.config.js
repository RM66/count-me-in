import { nextJsConfig } from "@repo/eslint-config/next-js";

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
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.*", "**/*.stories.*"],
    rules: {
      "countmein/no-untranslated-strings": "error",
    },
  },
  {
    // Component props are always `type` (any declaration named `*Props`).
    // Lives here, not in the shared base config: React components exist only
    // in this app. Other object shapes are the author's choice — `interface`
    // stays legal for plain object shapes and remains required in ambient
    // declarations (`**/*.d.ts`), where declaration merging needs it.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSInterfaceDeclaration[id.name=/Props$/]",
          message: "Component props use `type Props = { ... }`, never `interface`.",
        },
      ],
    },
  },
];
