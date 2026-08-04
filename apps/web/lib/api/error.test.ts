import { describe, expect, it } from 'vitest'

import { ApiError } from './error'

describe('ApiError', () => {
  it('stores the message and status code', () => {
    const err = new ApiError('Not found', 404)
    expect(err.message).toBe('Not found')
    expect(err.status).toBe(404)
  })

  it('sets name to ApiError', () => {
    const err = new ApiError('Boom', 500)
    expect(err.name).toBe('ApiError')
  })

  it('is an instance of Error', () => {
    const err = new ApiError('fail', 400)
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ApiError)
  })

  it('preserves the status code for different HTTP codes', () => {
    expect(new ApiError('bad', 400).status).toBe(400)
    expect(new ApiError('unauthorized', 401).status).toBe(401)
    expect(new ApiError('forbidden', 403).status).toBe(403)
    expect(new ApiError('server', 500).status).toBe(500)
  })
})
