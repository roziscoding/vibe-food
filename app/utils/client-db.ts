import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { toRaw } from 'vue'
import {
  clearPhase0RxdbData,
  ensurePhase0RxdbMigration,
  isPhase0SyncableClientKey,
  isPhase0SyncableCollectionKey,
  isPhase0SyncableValueKey,
  readPhase0SyncableCollection,
  readPhase0SyncableValue,
  writePhase0SyncableCollection,
  writePhase0SyncableValue
} from './db/rxdb-phase0'

interface VibeFoodDB extends DBSchema {
  collections: {
    key: string
    value: unknown
  }
}

const DB_NAME = 'vibe-food'
const DB_VERSION = 1
const COLLECTION_STORE = 'collections'

let dbPromise: Promise<IDBPDatabase<VibeFoodDB>> | null = null
let phase0MigrationPromise: Promise<void> | null = null

function getLegacyDb() {
  if (typeof window === 'undefined') {
    throw new Error('IndexedDB is only available in the browser')
  }

  if (!dbPromise) {
    dbPromise = openDB<VibeFoodDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(COLLECTION_STORE)) {
          db.createObjectStore(COLLECTION_STORE)
        }
      }
    })
  }

  return dbPromise
}

export async function readClientValue<T>(key: string): Promise<T | null> {
  if (isPhase0SyncableClientKey(key)) {
    await ensurePhase0SyncStoreReady()

    if (isPhase0SyncableCollectionKey(key)) {
      return (await readPhase0SyncableCollection(key)) as T
    }

    if (isPhase0SyncableValueKey(key)) {
      return (await readPhase0SyncableValue(key)) as T | null
    }
  }

  const value = await readLegacyClientValue<unknown>(key)

  return (value as T | undefined) ?? null
}

export async function readClientCollection<T>(key: string): Promise<T[]> {
  if (isPhase0SyncableCollectionKey(key)) {
    await ensurePhase0SyncStoreReady()
    const value = await readPhase0SyncableCollection(key)
    return Array.isArray(value) ? (value as T[]) : []
  }

  const value = await readClientValue<unknown>(key)

  return Array.isArray(value) ? (value as T[]) : []
}

export async function writeClientValue<T>(key: string, value: T): Promise<void> {
  const plainValue = cloneForIndexedDb(value)

  if (isPhase0SyncableClientKey(key)) {
    await ensurePhase0SyncStoreReady()

    if (isPhase0SyncableCollectionKey(key)) {
      if (!Array.isArray(plainValue)) {
        throw new Error(`Expected array value for syncable collection "${key}"`)
      }

      await writePhase0SyncableCollection(key, plainValue as unknown[])
      return
    }

    if (isPhase0SyncableValueKey(key)) {
      await writePhase0SyncableValue(key, plainValue)
      return
    }
  }

  await writeLegacyClientValue(key, plainValue)
}

export async function writeClientCollection<T>(key: string, value: T[]): Promise<void> {
  await writeClientValue(key, value)
}

export async function clearClientData(): Promise<void> {
  phase0MigrationPromise = null

  await clearPhase0RxdbData()

  const db = await getLegacyDb()
  await db.clear(COLLECTION_STORE)
}

async function ensurePhase0SyncStoreReady() {
  if (typeof window === 'undefined') {
    throw new Error('IndexedDB is only available in the browser')
  }

  if (!phase0MigrationPromise) {
    phase0MigrationPromise = ensurePhase0RxdbMigration(async () => ({
      'ingredients': await readLegacyClientValue<unknown>('ingredients'),
      'meals': await readLegacyClientValue<unknown>('meals'),
      'settings': await readLegacyClientValue<unknown>('settings'),
      'ai-integration': await readLegacyClientValue<unknown>('ai-integration')
    })).catch((error) => {
      phase0MigrationPromise = null
      throw error
    })
  }

  await phase0MigrationPromise
}

export async function ensureClientSyncStoreReady() {
  await ensurePhase0SyncStoreReady()
}

async function readLegacyClientValue<T>(key: string): Promise<T | null> {
  const db = await getLegacyDb()
  const value = await db.get(COLLECTION_STORE, key)

  return (value as T | undefined) ?? null
}

async function writeLegacyClientValue<T>(key: string, value: T): Promise<void> {
  const db = await getLegacyDb()
  await db.put(COLLECTION_STORE, value, key)
}

function cloneForIndexedDb<T>(value: T): T {
  const rawValue = toPlainValue(value)

  if (typeof structuredClone === 'function') {
    return structuredClone(rawValue)
  }

  return JSON.parse(JSON.stringify(rawValue)) as T
}

function toPlainValue<T>(value: T): T {
  return toPlainValueInternal(value, new WeakMap()) as T
}

function toPlainValueInternal(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== 'object') {
    return value
  }

  const rawValue = toRaw(value)

  if (seen.has(rawValue)) {
    return seen.get(rawValue)
  }

  if (Array.isArray(rawValue)) {
    const result: unknown[] = []
    seen.set(rawValue, result)

    for (const item of rawValue) {
      result.push(toPlainValueInternal(item, seen))
    }

    return result
  }

  if (rawValue instanceof Date) {
    return new Date(rawValue.getTime())
  }

  const result: Record<string, unknown> = {}
  seen.set(rawValue, result)

  for (const [key, nestedValue] of Object.entries(rawValue)) {
    result[key] = toPlainValueInternal(nestedValue, seen)
  }

  return result
}
