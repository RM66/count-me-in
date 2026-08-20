/** Custom error class for API operations. Includes HTTP status code. */

export class ApiError extends Error {
  /**
   * Optional machine-readable error code from the response body, when the
   * server sends one (e.g. `duplicate_booking`). Lets callers branch on the
   * *kind* of error rather than parsing the human-readable message.
   */
  readonly code?: string

  /**
   * The response body, when it carried extra fields beside `error` and `code`
   * (e.g. `seatsLeft` on a sold-out 409). Callers use it to render a localized
   * message with the actual numbers instead of the server's English copy.
   */
  readonly details?: Record<string, unknown>

  constructor(
    message: string,
    readonly status: number,
    code?: string,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.details = details
  }
}
