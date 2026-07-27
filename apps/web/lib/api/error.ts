/**
 * Custom error class for API operations.
 * Includes HTTP status code for proper error handling.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
