import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { toRaw } from 'vue'

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

function getDb() {
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
  const db = await getDb()
  const value = await db.get(COLLECTION_STORE, key)

  return (value as T | undefined) ?? null
}

export async function readClientCollection<T>(key: string): Promise<T[]> {
  const value = await readClientValue<unknown>(key)

  return Array.isArray(value) ? (value as T[]) : []
}

export async function writeClientValue<T>(key: string, value: T): Promise<void> {
  const db = await getDb()
  // IndexedDB cannot persist Vue reactive proxies directly.
  const plainValue = cloneForIndexedDb(value)
  await db.put(COLLECTION_STORE, plainValue, key)
}

export async function writeClientCollection<T>(key: string, value: T[]): Promise<void> {
  await writeClientValue(key, value)
}

export async function clearClientData(): Promise<void> {
  const db = await getDb()
  await db.clear(COLLECTION_STORE)
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
