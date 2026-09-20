/**
 * The exact Zod v4 default messages the Go rules reproduce. Go logs and TS logs
 * should read the same for the same rejection; a Zod upgrade that rewords one
 * is caught by messages.test.ts rather than discovered in a log.
 *
 * stringTooSmall/stringTooBig/enumOneOf are interpolated into the generated
 * rules (validation_gen.go). intTooSmall/intTooBig/arrayTooSmall/arrayTooBig
 * are not — their Go call sites are hand-written (intRange in rules.go,
 * strArrValue/optStrArr in errors.go, the minItems checks in refine.go) — so
 * they exist purely as the pin messages.test.ts checks: the failing test is
 * what tells a human to update the hand-written Go copies when Zod rewords.
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
