/**
 * Reference Zod v4 default messages. Since ADR-016 request validation is
 * the spec decode (which phrases its own messages) and vectors pin error keys,
 * not text, these are not interpolated into generated code. They exist purely as
 * the pin messages.test.ts checks: a Zod upgrade that rewords one surfaces
 * as a failing test rather than a silent log divergence. The remaining
 * hand-written API messages that intentionally match Zod word-for-word
 * (options uniqueness / minItems in validation/refine.py) are covered by that test.
 */
export const zodMessages = {
  stringTooSmall: (min: number) => `Too small: expected string to have >=${min} characters`,
  stringTooBig: (max: number) => `Too big: expected string to have <=${max} characters`,
  intTooSmall: (min: number) => `Too small: expected number to be >=${min}`,
  intTooBig: (max: number) => `Too big: expected number to be <=${max}`,
  enumOneOf: (values: readonly string[]) =>
    `Invalid option: expected one of ${values.map((v) => `"${v}"`).join('|')}`,
  arrayTooSmall: (min: number) => `Too small: expected array to have >=${min} items`,
  arrayTooBig: (max: number) => `Too big: expected array to have <=${max} items`,
} as const
