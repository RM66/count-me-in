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
];
