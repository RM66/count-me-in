/** Custom error class for API operations. Includes HTTP status code. */

export class ApiError extends Error {
  /**
   * Optional machine-readable error code from the response body, when the
   * server sends one (e.g. `duplicate_booking`). Lets callers branch on the
   * *kind* of error rather than parsing the human-readable message.
   */
  readonly code?: string

  constructor(
    message: string,
    readonly status: number,
    code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}
