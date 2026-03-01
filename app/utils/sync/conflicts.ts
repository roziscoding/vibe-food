import {
  appendPhase0SyncConflictEntry,
  readPhase0SyncConflictEntries,
  type Phase0SyncConflictEntry
} from '../db/rxdb-phase0'
import type { SyncableCollectionName } from '#shared/utils/sync/protocol'

export type LocalSyncConflictEntry = Phase0SyncConflictEntry

export async function logLocalSyncConflict(input: {
  collectionName: SyncableCollectionName | string
  documentId: string
  reason: string
  createdAt?: string
}): Promise<LocalSyncConflictEntry | null> {
  try {
    return await appendPhase0SyncConflictEntry(input)
  } catch (error) {
    console.error('Failed to persist local sync conflict entry', error)
    return null
  }
}

export async function readLocalSyncConflictEntries(limit = 20): Promise<LocalSyncConflictEntry[]> {
  try {
    return await readPhase0SyncConflictEntries(limit)
  } catch (error) {
    console.error('Failed to read local sync conflict entries', error)
    return []
  }
}
