import type { RxCollection, RxDatabase, RxJsonSchema } from 'rxdb'

export type Phase0SyncableClientKey = 'ingredients' | 'meals' | 'settings'
export type Phase0SyncableCollectionKey = 'ingredients' | 'meals'
export type Phase0SyncableValueKey = 'settings'

type SyncMetadataFields = {
  updatedAt: string
  deletedAt: string | null
  lastModifiedByDeviceId: string
  syncVersion: string
}

type SyncableDoc = SyncMetadataFields & {
  id: string
  [key: string]: unknown
}

type SyncMetaDoc = {
  id: string
  value: string
  updatedAt: string
}

type SyncConflictDoc = {
  id: string
  collectionName: string
  documentId: string
  reason: string
  createdAt: string
}

type Phase0Collections = {
  ingredients: RxCollection<SyncableDoc>
  meals: RxCollection<SyncableDoc>
  settings: RxCollection<SyncableDoc>
  sync_meta: RxCollection<SyncMetaDoc>
  sync_conflicts: RxCollection<SyncConflictDoc>
}

type Phase0Database = RxDatabase<Phase0Collections>

type Phase0Runtime = {
  createRxDatabase: (options: {
    name: string
    storage: unknown
    multiInstance?: boolean
    eventReduce?: boolean
    ignoreDuplicate?: boolean
  }) => Promise<RxDatabase>
  removeRxDatabase: (databaseName: string, storage: unknown) => Promise<string[]>
  getRxStorageDexie: () => unknown
}

type LegacyPhase0Snapshot = {
  ingredients: unknown
  meals: unknown
  settings: unknown
}

const PHASE0_SYNCABLE_COLLECTION_KEYS = ['ingredients', 'meals'] as const
const PHASE0_SYNCABLE_VALUE_KEYS = ['settings'] as const
const PHASE0_SYNCABLE_KEYS = [
  ...PHASE0_SYNCABLE_COLLECTION_KEYS,
  ...PHASE0_SYNCABLE_VALUE_KEYS
] as const

const RXDB_NAME = 'vibe-food-rxdb'
const SETTINGS_DOCUMENT_ID = 'app-settings'
const META_DOC_MIGRATION_COMPLETE = 'phase0-migration-complete'
const META_DOC_LOCAL_DEVICE_ID = 'phase0-local-device-id'

let rxdbRuntimePromise: Promise<Phase0Runtime> | null = null
let phase0DbPromise: Promise<Phase0Database> | null = null

export function isPhase0SyncableClientKey(key: string): key is Phase0SyncableClientKey {
  return (PHASE0_SYNCABLE_KEYS as readonly string[]).includes(key)
}

export function isPhase0SyncableCollectionKey(key: string): key is Phase0SyncableCollectionKey {
  return (PHASE0_SYNCABLE_COLLECTION_KEYS as readonly string[]).includes(key)
}

export function isPhase0SyncableValueKey(key: string): key is Phase0SyncableValueKey {
  return (PHASE0_SYNCABLE_VALUE_KEYS as readonly string[]).includes(key)
}

export async function ensurePhase0RxdbMigration(loadLegacySnapshot: () => Promise<LegacyPhase0Snapshot>): Promise<void> {
  assertBrowser()
  const db = await getPhase0Database()

  if (await isMigrationComplete(db)) {
    await ensureLocalDeviceId(db)
    return
  }

  const snapshot = await loadLegacySnapshot()

  await importLegacyCollectionSnapshot(db, 'ingredients', snapshot.ingredients)
  await importLegacyCollectionSnapshot(db, 'meals', snapshot.meals)
  await importLegacySettingsValue(db, snapshot.settings)
  await ensureLocalDeviceId(db)
  await setMetaValue(db, META_DOC_MIGRATION_COMPLETE, '1')
}

export async function readPhase0SyncableCollection(key: Phase0SyncableCollectionKey): Promise<unknown[]> {
  assertBrowser()
  const db = await getPhase0Database()
  const collection = getCollection(db, key)
  const docs = await collection.find().exec()

  return docs
    .map(doc => doc.toMutableJSON())
    .filter(isNotDeleted)
}

export async function writePhase0SyncableCollection(key: Phase0SyncableCollectionKey, snapshot: unknown[]): Promise<void> {
  assertBrowser()
  const db = await getPhase0Database()
  const collection = getCollection(db, key)
  const deviceId = await ensureLocalDeviceId(db)
  const existingDocs = await collection.find().exec()
  const existingById = new Map(existingDocs.map((doc) => {
    const json = doc.toMutableJSON() as SyncableDoc
    return [json.id, json]
  }))

  const nextActiveIds = new Set<string>()
  const writes: SyncableDoc[] = []

  for (const item of snapshot) {
    if (!isRecordWithStringId(item)) {
      continue
    }

    const incoming = item as Record<string, unknown> & { id: string }
    nextActiveIds.add(incoming.id)
    const previous = existingById.get(incoming.id)
    writes.push(buildActiveDocument(incoming, previous, deviceId))
  }

  for (const previous of existingById.values()) {
    if (previous.deletedAt !== null) {
      continue
    }

    if (nextActiveIds.has(previous.id)) {
      continue
    }

    writes.push(buildDeletedDocument(previous, deviceId))
  }

  if (writes.length === 0) {
    return
  }

  const result = await collection.bulkUpsert(writes)

  if (result.error.length > 0) {
    throw new Error(`Failed to persist ${key} snapshot to RxDB`)
  }
}

export async function readPhase0SyncableValue(key: Phase0SyncableValueKey): Promise<unknown | null> {
  assertBrowser()
  const db = await getPhase0Database()
  const collection = getCollection(db, key)
  const doc = await collection.findOne(SETTINGS_DOCUMENT_ID).exec()

  if (!doc) {
    return null
  }

  const json = doc.toMutableJSON() as SyncableDoc

  if (json.deletedAt !== null) {
    return null
  }

  return json
}

export async function writePhase0SyncableValue(key: Phase0SyncableValueKey, value: unknown): Promise<void> {
  assertBrowser()

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected object value for syncable key "${key}"`)
  }

  const db = await getPhase0Database()
  const collection = getCollection(db, key)
  const previous = await collection.findOne(SETTINGS_DOCUMENT_ID).exec()
  const previousDoc = previous?.toMutableJSON() as SyncableDoc | undefined
  const deviceId = await ensureLocalDeviceId(db)
  const incoming = {
    ...(value as Record<string, unknown>),
    id: SETTINGS_DOCUMENT_ID
  }
  const next = buildActiveDocument(incoming, previousDoc, deviceId)
  const result = await collection.bulkUpsert([next])

  if (result.error.length > 0) {
    throw new Error(`Failed to persist ${key} to RxDB`)
  }
}

export async function clearPhase0RxdbData(): Promise<void> {
  assertBrowser()

  if (phase0DbPromise) {
    const db = await phase0DbPromise
    phase0DbPromise = null
    await db.remove()
    return
  }

  const runtime = await loadRxdbRuntime()
  await runtime.removeRxDatabase(RXDB_NAME, runtime.getRxStorageDexie())
}

async function getPhase0Database(): Promise<Phase0Database> {
  assertBrowser()

  if (!phase0DbPromise) {
    phase0DbPromise = createPhase0Database().catch((error) => {
      phase0DbPromise = null
      throw error
    })
  }

  return phase0DbPromise
}

async function createPhase0Database(): Promise<Phase0Database> {
  const runtime = await loadRxdbRuntime()
  const database = await runtime.createRxDatabase({
    name: RXDB_NAME,
    storage: runtime.getRxStorageDexie(),
    multiInstance: true,
    eventReduce: true
  })

  await database.addCollections({
    ingredients: {
      schema: INGREDIENTS_SCHEMA
    },
    meals: {
      schema: MEALS_SCHEMA
    },
    settings: {
      schema: SETTINGS_SCHEMA
    },
    sync_meta: {
      schema: SYNC_META_SCHEMA
    },
    sync_conflicts: {
      schema: SYNC_CONFLICTS_SCHEMA
    }
  })

  return database as unknown as Phase0Database
}

async function loadRxdbRuntime(): Promise<Phase0Runtime> {
  if (!rxdbRuntimePromise) {
    rxdbRuntimePromise = (async () => {
      const [rxdbModule, dexieStorageModule] = await Promise.all([
        import('rxdb'),
        import('rxdb/plugins/storage-dexie')
      ])

      return {
        createRxDatabase: rxdbModule.createRxDatabase as Phase0Runtime['createRxDatabase'],
        removeRxDatabase: rxdbModule.removeRxDatabase as Phase0Runtime['removeRxDatabase'],
        getRxStorageDexie: dexieStorageModule.getRxStorageDexie as Phase0Runtime['getRxStorageDexie']
      }
    })().catch((error) => {
      rxdbRuntimePromise = null
      throw error
    })
  }

  return rxdbRuntimePromise
}

async function importLegacyCollectionSnapshot(
  db: Phase0Database,
  key: Phase0SyncableCollectionKey,
  legacyValue: unknown
) {
  if (!Array.isArray(legacyValue) || legacyValue.length === 0) {
    return
  }

  const collection = getCollection(db, key)
  const alreadyHasDocs = await collection.findOne().exec()

  if (alreadyHasDocs) {
    return
  }

  const deviceId = await ensureLocalDeviceId(db)
  const docs = legacyValue
    .filter(isRecordWithStringId)
    .map(item => buildImportedDocument(item, deviceId))

  if (docs.length === 0) {
    return
  }

  const result = await collection.bulkUpsert(docs)

  if (result.error.length > 0) {
    throw new Error(`Failed to import legacy ${key} data into RxDB`)
  }
}

async function importLegacySettingsValue(db: Phase0Database, legacyValue: unknown) {
  if (!legacyValue || typeof legacyValue !== 'object' || Array.isArray(legacyValue)) {
    return
  }

  const collection = getCollection(db, 'settings')
  const existing = await collection.findOne(SETTINGS_DOCUMENT_ID).exec()

  if (existing) {
    return
  }

  const deviceId = await ensureLocalDeviceId(db)
  const doc = buildImportedDocument({
    ...(legacyValue as Record<string, unknown>),
    id: SETTINGS_DOCUMENT_ID
  }, deviceId)
  const result = await collection.bulkUpsert([doc])

  if (result.error.length > 0) {
    throw new Error('Failed to import legacy settings into RxDB')
  }
}

async function isMigrationComplete(db: Phase0Database) {
  const doc = await db.collections.sync_meta.findOne(META_DOC_MIGRATION_COMPLETE).exec()
  return doc?.get('value') === '1'
}

async function ensureLocalDeviceId(db: Phase0Database): Promise<string> {
  const existing = await db.collections.sync_meta.findOne(META_DOC_LOCAL_DEVICE_ID).exec()

  if (existing) {
    const value = existing.get('value')

    if (typeof value === 'string' && value.trim()) {
      return value
    }
  }

  const value = createLocalId()
  await setMetaValue(db, META_DOC_LOCAL_DEVICE_ID, value)
  return value
}

async function setMetaValue(db: Phase0Database, id: string, value: string) {
  const result = await db.collections.sync_meta.bulkUpsert([{
    id,
    value,
    updatedAt: new Date().toISOString()
  }])

  if (result.error.length > 0) {
    throw new Error(`Failed to write sync meta "${id}"`)
  }
}

function getCollection(db: Phase0Database, key: Phase0SyncableCollectionKey | Phase0SyncableValueKey): RxCollection<SyncableDoc> {
  return db.collections[key]
}

function buildImportedDocument(record: Record<string, unknown> & { id: string }, deviceId: string): SyncableDoc {
  const imported = { ...record }
  const nowIso = new Date().toISOString()
  const updatedAt = normalizeIsoString(imported.updatedAt, normalizeIsoString(imported.createdAt, nowIso))
  const deletedAt = normalizeNullableIsoString(imported.deletedAt)
  const lastModifiedByDeviceId = normalizeNonEmptyString(imported.lastModifiedByDeviceId, deviceId)
  const syncVersion = normalizeNonEmptyString(imported.syncVersion, createSyncVersion(updatedAt))

  return {
    ...stripSyncMetadata(imported),
    id: imported.id,
    updatedAt,
    deletedAt,
    lastModifiedByDeviceId,
    syncVersion
  }
}

function buildActiveDocument(
  record: Record<string, unknown> & { id: string },
  previous: SyncableDoc | undefined,
  deviceId: string
): SyncableDoc {
  const base = stripSyncMetadata(record)

  if (previous && previous.deletedAt === null && areDocsEquivalent(base, stripSyncMetadata(previous))) {
    return previous
  }

  if (previous && previous.deletedAt !== null && areDocsEquivalent(base, stripSyncMetadata(previous))) {
    // Restore a tombstoned record without changing the business fields.
    const updatedAt = new Date().toISOString()
    return {
      ...base,
      id: record.id,
      updatedAt,
      deletedAt: null,
      lastModifiedByDeviceId: deviceId,
      syncVersion: createSyncVersion(updatedAt)
    }
  }

  if (previous) {
    const updatedAt = new Date().toISOString()
    return {
      ...base,
      id: record.id,
      updatedAt,
      deletedAt: null,
      lastModifiedByDeviceId: deviceId,
      syncVersion: createSyncVersion(updatedAt)
    }
  }

  const nowIso = new Date().toISOString()
  const updatedAt = normalizeIsoString(record.updatedAt, normalizeIsoString(record.createdAt, nowIso))

  return {
    ...base,
    id: record.id,
    updatedAt,
    deletedAt: null,
    lastModifiedByDeviceId: deviceId,
    syncVersion: createSyncVersion(updatedAt)
  }
}

function buildDeletedDocument(previous: SyncableDoc, deviceId: string): SyncableDoc {
  const deletedAt = new Date().toISOString()

  return {
    ...stripSyncMetadata(previous),
    id: previous.id,
    updatedAt: deletedAt,
    deletedAt,
    lastModifiedByDeviceId: deviceId,
    syncVersion: createSyncVersion(deletedAt)
  }
}

function stripSyncMetadata(record: Record<string, unknown>) {
  const {
    updatedAt: _updatedAt,
    deletedAt: _deletedAt,
    lastModifiedByDeviceId: _lastModifiedByDeviceId,
    syncVersion: _syncVersion,
    ...rest
  } = record

  return rest
}

function isNotDeleted(doc: unknown): doc is Record<string, unknown> {
  return !isRecordWithStringId(doc) || doc.deletedAt == null
}

function isRecordWithStringId(value: unknown): value is Record<string, unknown> & { id: string } {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as { id?: unknown }).id === 'string'
    && (value as { id: string }).id.trim()
  )
}

function normalizeIsoString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback
  }

  const trimmed = value.trim()

  if (!trimmed) {
    return fallback
  }

  const timestamp = Date.parse(trimmed)

  if (Number.isNaN(timestamp)) {
    return fallback
  }

  return new Date(timestamp).toISOString()
}

function normalizeNullableIsoString(value: unknown): string | null {
  if (value == null) {
    return null
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  if (!trimmed) {
    return null
  }

  const timestamp = Date.parse(trimmed)

  if (Number.isNaN(timestamp)) {
    return null
  }

  return new Date(timestamp).toISOString()
}

function normalizeNonEmptyString(value: unknown, fallback: string) {
  if (typeof value !== 'string') {
    return fallback
  }

  const trimmed = value.trim()
  return trimmed || fallback
}

function areDocsEquivalent(left: Record<string, unknown>, right: Record<string, unknown>) {
  return stableSerialize(left) === stableSerialize(right)
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`
  }

  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`
}

function createSyncVersion(updatedAtIso: string) {
  return `${updatedAtIso}:${Math.random().toString(36).slice(2, 10)}`
}

function createLocalId() {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  const randomPart = Math.random().toString(36).slice(2, 10)
  return `device-${Date.now()}-${randomPart}`
}

function assertBrowser() {
  if (typeof window === 'undefined') {
    throw new Error('RxDB phase 0 storage is only available in the browser')
  }
}

const COMMON_SYNC_PROPERTIES = {
  updatedAt: { type: 'string' },
  deletedAt: { type: ['string', 'null'] },
  lastModifiedByDeviceId: { type: 'string' },
  syncVersion: { type: 'string' }
} as const

const INGREDIENTS_SCHEMA = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  additionalProperties: true,
  properties: {
    id: { type: 'string', maxLength: 200 },
    name: { type: 'string' },
    createdAt: { type: 'string' },
    ...COMMON_SYNC_PROPERTIES
  },
  required: ['id', 'updatedAt', 'deletedAt', 'lastModifiedByDeviceId', 'syncVersion']
} as unknown as RxJsonSchema<SyncableDoc>

const MEALS_SCHEMA = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  additionalProperties: true,
  properties: {
    id: { type: 'string', maxLength: 200 },
    name: { type: 'string' },
    createdAt: { type: 'string' },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true
      }
    },
    ...COMMON_SYNC_PROPERTIES
  },
  required: ['id', 'updatedAt', 'deletedAt', 'lastModifiedByDeviceId', 'syncVersion']
} as unknown as RxJsonSchema<SyncableDoc>

const SETTINGS_SCHEMA = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  additionalProperties: true,
  properties: {
    id: { type: 'string', maxLength: 200 },
    dailyCalorieGoal: { type: 'number' },
    proteinGoal: { type: 'number' },
    carbsGoal: { type: 'number' },
    fatGoal: { type: 'number' },
    ...COMMON_SYNC_PROPERTIES
  },
  required: ['id', 'updatedAt', 'deletedAt', 'lastModifiedByDeviceId', 'syncVersion']
} as unknown as RxJsonSchema<SyncableDoc>

const SYNC_META_SCHEMA = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', maxLength: 200 },
    value: { type: 'string' },
    updatedAt: { type: 'string' }
  },
  required: ['id', 'value', 'updatedAt']
} as unknown as RxJsonSchema<SyncMetaDoc>

const SYNC_CONFLICTS_SCHEMA = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', maxLength: 200 },
    collectionName: { type: 'string' },
    documentId: { type: 'string' },
    reason: { type: 'string' },
    createdAt: { type: 'string' }
  },
  required: ['id', 'collectionName', 'documentId', 'reason', 'createdAt']
} as unknown as RxJsonSchema<SyncConflictDoc>
