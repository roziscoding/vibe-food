import { describe, expect, it } from 'vitest'
import {
  compareSyncCheckpoint,
  compareSyncDocumentToCheckpoint,
  compareSyncDocumentsLww,
  createSyncCheckpoint,
  normalizeSyncTransportDocument
} from '../../shared/utils/sync/protocol'

describe('sync protocol ordering', () => {
  it('prefers the newer updatedAt value for LWW conflict resolution', () => {
    const older = {
      id: 'doc-1',
      updatedAt: '2026-03-01T09:00:00.000Z',
      deletedAt: null,
      lastModifiedByDeviceId: 'device-a',
      syncVersion: '1'
    }
    const newer = {
      ...older,
      updatedAt: '2026-03-01T10:00:00.000Z'
    }

    expect(compareSyncDocumentsLww(older, newer)).toBeLessThan(0)
    expect(compareSyncDocumentsLww(newer, older)).toBeGreaterThan(0)
  })

  it('uses device id as the tie-breaker when timestamps match', () => {
    const left = {
      id: 'doc-1',
      updatedAt: '2026-03-01T10:00:00.000Z',
      deletedAt: null,
      lastModifiedByDeviceId: 'device-a',
      syncVersion: '1'
    }
    const right = {
      ...left,
      lastModifiedByDeviceId: 'device-b'
    }

    expect(compareSyncDocumentsLww(left, right)).toBeLessThan(0)
    expect(compareSyncDocumentsLww(right, left)).toBeGreaterThan(0)
  })

  it('orders checkpoints consistently for pull resume comparisons', () => {
    const checkpoint = createSyncCheckpoint({
      id: 'doc-1',
      updatedAt: '2026-03-01T10:00:00.000Z',
      lastModifiedByDeviceId: 'device-a',
      syncVersion: '1'
    })
    const laterDocument = {
      id: 'doc-2',
      updatedAt: '2026-03-01T10:00:00.000Z',
      deletedAt: null,
      lastModifiedByDeviceId: 'device-b',
      syncVersion: '1'
    }

    expect(compareSyncCheckpoint(checkpoint, createSyncCheckpoint(laterDocument))).toBeLessThan(0)
    expect(compareSyncDocumentToCheckpoint(laterDocument, checkpoint)).toBeGreaterThan(0)
  })
})

describe('sync protocol tombstones', () => {
  it('normalizes explicit tombstones into deleted documents', () => {
    const tombstone = normalizeSyncTransportDocument({
      id: 'doc-1',
      updatedAt: '2026-03-01T12:00:00.000Z',
      deletedAt: null,
      _deleted: true,
      lastModifiedByDeviceId: 'device-a',
      syncVersion: '4'
    })

    expect(tombstone).toEqual({
      id: 'doc-1',
      updatedAt: '2026-03-01T12:00:00.000Z',
      deletedAt: '2026-03-01T12:00:00.000Z',
      _deleted: true,
      lastModifiedByDeviceId: 'device-a',
      syncVersion: '4'
    })
  })
})
