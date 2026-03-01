import { describe, expect, it } from 'vitest'
import {
  SyncHttpError,
  classifyLocalSyncError,
  formatLocalSyncErrorMessage
} from '../../app/utils/sync/errors'

describe('local sync error classification', () => {
  it('treats transient network failures as retryable', () => {
    expect(classifyLocalSyncError(new TypeError('Failed to fetch'))).toEqual({
      code: 'network',
      retryable: true,
      message: 'Failed to fetch'
    })
  })

  it('treats unauthorized sync responses as non-retryable auth errors', () => {
    expect(classifyLocalSyncError(new SyncHttpError('Unauthorized', 401))).toEqual({
      code: 'auth',
      retryable: false,
      message: 'Unauthorized'
    })
  })

  it('formats retry messages with the backoff delay', () => {
    const formatted = formatLocalSyncErrorMessage({
      code: 'server',
      retryable: true,
      message: 'Sync replication request failed.'
    }, 15_000)

    expect(formatted).toBe('Server error: Sync replication request failed. Retrying in 15 seconds.')
  })
})
