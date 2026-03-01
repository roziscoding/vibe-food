import type { RxCollection } from 'rxdb'
import type { RxReplicationState } from 'rxdb/plugins/replication'
import { ensureClientSyncStoreReady } from '../client-db'
import { getPhase0SyncCollections } from '../db/rxdb-phase0'
import {
  buildSyncAuthHeaders,
  readLocalSyncVaultPassphrase,
  type LocalSyncVaultCredentials
} from './credentials'
import { logLocalSyncConflict } from './conflicts'
import { createSyncHttpError } from './errors'
import {
  decryptSyncTransportDocument,
  encryptSyncTransportDocument,
  fetchSyncVaultKeyRecord,
  unwrapSyncVaultKeyRecord
} from './e2ee'
import {
  normalizeSyncEncryptedTransportDocument,
  normalizeSyncTransportDocument,
  SYNCABLE_COLLECTION_NAMES,
  SYNC_API_BASE,
  SYNC_TRANSPORT_MODE_E2EE_V1,
  SYNC_TRANSPORT_MODE_PLAINTEXT_DEV,
  type SyncPullCheckpoint,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResponse,
  type SyncTransportDocument,
  type SyncTransportPayload,
  type SyncableCollectionName
} from '#shared/utils/sync/protocol'

type SyncReplicationDocument = SyncTransportDocument & { _deleted: boolean }
type SyncCollectionReplicationState = RxReplicationState<SyncReplicationDocument, SyncPullCheckpoint>
type SyncTransportAdapter = {
  encodeDocument: (
    document: SyncReplicationDocument,
    collectionName: SyncableCollectionName
  ) => Promise<SyncTransportPayload>
  decodeDocument: (
    payload: SyncTransportPayload,
    collectionName: SyncableCollectionName
  ) => Promise<SyncReplicationDocument | null>
}

type SyncReplicationRuntimeInput = {
  credentials: LocalSyncVaultCredentials
  deviceId: string
  onActiveChange?: (active: boolean) => void
  onError?: (error: Error) => void
}

export type SyncReplicationRuntime = {
  credentials: LocalSyncVaultCredentials
  deviceId: string
  start: () => Promise<void>
  pause: () => Promise<void>
  reSync: () => void
  awaitInSync: () => Promise<void>
  cancel: () => Promise<void>
}

let syncReplicationRuntimePromise: Promise<SyncReplicationRuntime> | null = null
let activeSyncReplicationRuntime: SyncReplicationRuntime | null = null

export async function ensureSyncReplicationRuntime(input: SyncReplicationRuntimeInput): Promise<SyncReplicationRuntime> {
  if (
    activeSyncReplicationRuntime
    && activeSyncReplicationRuntime.credentials.vaultId === input.credentials.vaultId
    && activeSyncReplicationRuntime.credentials.vaultToken === input.credentials.vaultToken
    && activeSyncReplicationRuntime.deviceId === input.deviceId
  ) {
    return activeSyncReplicationRuntime
  }

  if (activeSyncReplicationRuntime) {
    await activeSyncReplicationRuntime.cancel()
    activeSyncReplicationRuntime = null
  }

  if (!syncReplicationRuntimePromise) {
    syncReplicationRuntimePromise = createSyncReplicationRuntime(input)
      .then((runtime) => {
        activeSyncReplicationRuntime = runtime
        return runtime
      })
      .catch((error) => {
        syncReplicationRuntimePromise = null
        throw error
      })
  }

  const runtime = await syncReplicationRuntimePromise
  syncReplicationRuntimePromise = null
  return runtime
}

export async function cancelSyncReplicationRuntime(): Promise<void> {
  if (syncReplicationRuntimePromise) {
    const pending = await syncReplicationRuntimePromise.catch(() => null)
    syncReplicationRuntimePromise = null

    if (pending) {
      await pending.cancel()
    }
  }

  if (!activeSyncReplicationRuntime) {
    return
  }

  const runtime = activeSyncReplicationRuntime
  activeSyncReplicationRuntime = null
  await runtime.cancel()
}

async function createSyncReplicationRuntime(input: SyncReplicationRuntimeInput): Promise<SyncReplicationRuntime> {
  await ensureClientSyncStoreReady()

  const [{ replicateRxCollection }, collections, transportAdapter] = await Promise.all([
    import('rxdb/plugins/replication'),
    getPhase0SyncCollections(),
    createSyncTransportAdapter(input.credentials, input.deviceId)
  ])

  const states = new Map<SyncableCollectionName, SyncCollectionReplicationState>()
  const activeByCollection = new Map<SyncableCollectionName, boolean>()
  const subscriptions: Array<{ unsubscribe: () => void }> = []

  for (const collectionName of SYNCABLE_COLLECTION_NAMES) {
    const collection = collections[collectionName] as unknown as RxCollection<SyncReplicationDocument>
    const state = replicateRxCollection<SyncReplicationDocument, SyncPullCheckpoint>({
      replicationIdentifier: `vibe-food-sync-${input.credentials.vaultId}-${collectionName}`,
      collection,
      live: true,
      waitForLeadership: false,
      autoStart: false,
      pull: {
        batchSize: 50,
        handler: (checkpoint, batchSize) => pullCollectionDocuments(
          input.credentials,
          input.deviceId,
          transportAdapter,
          collectionName,
          checkpoint,
          batchSize
        )
      },
      push: {
        batchSize: 25,
        handler: async (rows) => {
          const response = await postSyncJson<SyncPushRequest, SyncPushResponse>(
            `${SYNC_API_BASE}/replication/${collectionName}/push`,
            {
              rows: await Promise.all(rows.map(async row => ({
                newDocumentState: await transportAdapter.encodeDocument(
                  toSyncTransportDocument(row.newDocumentState),
                  collectionName
                ),
                assumedMasterState: row.assumedMasterState
                  ? await transportAdapter.encodeDocument(
                      toSyncTransportDocument(row.assumedMasterState),
                      collectionName
                    )
                  : undefined
              })))
            },
            input.credentials,
            input.deviceId
          )

          const conflicts = await Promise.all(
            response.conflicts.map(document => decodeIncomingSyncPayload(transportAdapter, document, collectionName))
          )

          const normalizedConflicts = conflicts.filter(
            (document: SyncReplicationDocument | null): document is SyncReplicationDocument => Boolean(document)
          )

          await Promise.all(normalizedConflicts.map(document => logLocalSyncConflict({
            collectionName,
            documentId: document.id,
            reason: 'push-conflict:remote-wins'
          })))

          return normalizedConflicts
        }
      }
    }) as SyncCollectionReplicationState

    states.set(collectionName, state)
    activeByCollection.set(collectionName, false)

    subscriptions.push(state.active$.subscribe((isActive) => {
      activeByCollection.set(collectionName, isActive)
      input.onActiveChange?.(Array.from(activeByCollection.values()).some(Boolean))
    }))

    subscriptions.push(state.error$.subscribe((error) => {
      input.onError?.(toError(error))
    }))
  }

  return {
    credentials: input.credentials,
    deviceId: input.deviceId,
    async start() {
      await Promise.all(Array.from(states.values()).map(state => state.start()))
    },
    async pause() {
      await Promise.all(Array.from(states.values()).map(state => state.pause()))
      input.onActiveChange?.(false)
    },
    reSync() {
      for (const state of states.values()) {
        state.reSync()
      }
    },
    async awaitInSync() {
      await Promise.all(Array.from(states.values()).map(state => state.awaitInSync()))
    },
    async cancel() {
      for (const subscription of subscriptions) {
        subscription.unsubscribe()
      }

      await Promise.all(Array.from(states.values()).map(state => state.cancel()))
    }
  }
}

async function pullCollectionDocuments(
  credentials: LocalSyncVaultCredentials,
  deviceId: string,
  transportAdapter: SyncTransportAdapter,
  collectionName: SyncableCollectionName,
  checkpoint: SyncPullCheckpoint | undefined,
  batchSize: number
): Promise<{ checkpoint: SyncPullCheckpoint | undefined, documents: SyncReplicationDocument[] }> {
  const response = await postSyncJson<{ checkpoint?: SyncPullCheckpoint, batchSize: number }, SyncPullResponse>(
    `${SYNC_API_BASE}/replication/${collectionName}/pull`,
    {
      checkpoint,
      batchSize
    },
    credentials,
    deviceId
  )

  return {
    checkpoint: response.checkpoint,
    documents: (
      await Promise.all(
        response.documents.map(document => decodeIncomingSyncPayload(transportAdapter, document, collectionName))
      )
    ).filter((document: SyncReplicationDocument | null): document is SyncReplicationDocument => Boolean(document))
  }
}

function toSyncTransportDocument(value: Record<string, unknown>) {
  const {
    _attachments: _attachments,
    _meta: _meta,
    _rev: _rev,
    ...rest
  } = value
  const normalized = normalizeSyncTransportDocument(rest)

  if (!normalized) {
    throw new Error('Could not serialize a sync document for replication.')
  }

  return normalized as SyncReplicationDocument
}

async function createSyncTransportAdapter(
  credentials: LocalSyncVaultCredentials,
  deviceId: string
): Promise<SyncTransportAdapter> {
  switch (credentials.transportMode) {
    case SYNC_TRANSPORT_MODE_PLAINTEXT_DEV:
      return {
        async encodeDocument(document) {
          return document
        },
        async decodeDocument(payload) {
          const normalized = normalizeSyncTransportDocument(payload)
          return normalized ? normalized as SyncReplicationDocument : null
        }
      }
    case SYNC_TRANSPORT_MODE_E2EE_V1: {
      const passphrase = await readLocalSyncVaultPassphrase(credentials.vaultId)

      if (!passphrase) {
        throw new Error('This device is missing the local sync passphrase required for the encrypted vault.')
      }

      const keyRecord = await fetchSyncVaultKeyRecord(credentials, deviceId)
      const masterKey = await unwrapSyncVaultKeyRecord(keyRecord, passphrase)

      return {
        encodeDocument(document, collectionName) {
          return encryptSyncTransportDocument({
            document,
            vaultId: credentials.vaultId,
            collectionName,
            masterKey,
            keyVersion: keyRecord.keyVersion
          })
        },
        async decodeDocument(payload, collectionName) {
          const envelope = normalizeSyncEncryptedTransportDocument(payload)

          if (!envelope) {
            return null
          }

          const normalized = await decryptSyncTransportDocument({
            document: envelope,
            vaultId: credentials.vaultId,
            collectionName,
            masterKey,
            expectedKeyVersion: keyRecord.keyVersion
          })

          return normalized as SyncReplicationDocument
        }
      }
    }
    default:
      throw new Error('Unsupported sync transport mode.')
  }
}

async function decodeIncomingSyncPayload(
  transportAdapter: SyncTransportAdapter,
  payload: SyncTransportPayload,
  collectionName: SyncableCollectionName
) {
  try {
    return await transportAdapter.decodeDocument(payload, collectionName)
  } catch (error) {
    await logLocalSyncConflict({
      collectionName,
      documentId: typeof payload.id === 'string' && payload.id.trim() ? payload.id : 'unknown',
      reason: error instanceof Error ? `decode-error:${error.message}` : 'decode-error:unknown'
    })
    throw error
  }
}

async function postSyncJson<TRequest, TResponse>(
  input: string,
  body: TRequest,
  credentials: LocalSyncVaultCredentials,
  deviceId: string
) {
  const response = await fetch(input, {
    method: 'POST',
    headers: buildSyncAuthHeaders(credentials, deviceId),
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    throw await createSyncHttpError(response, 'Sync replication request failed.')
  }

  return response.json() as Promise<TResponse>
}

function toError(value: unknown) {
  if (value instanceof Error) {
    return value
  }

  return new Error(typeof value === 'string' ? value : 'Sync replication failed.')
}
