import { readClientValue, writeClientValue } from './client-db'
import type { AiProvider } from './client-settings'

type LegacyStoredAiIntegrationV1 = {
  version: 1
  provider: AiProvider
  keyPreview: string
  encryptedApiKey: string
  salt: string
  iv: string
  kdf: {
    name: 'PBKDF2'
    hash: 'SHA-256'
    iterations: number
  }
  keyUpdatedAt: string
}

type StoredAiIntegrationV2 = {
  version: 2
  provider: AiProvider
  apiKey: string
  updatedAt: string
}

type StoredAiIntegrationRecord = LegacyStoredAiIntegrationV1 | StoredAiIntegrationV2

export type AiIntegrationMetadata = {
  provider: AiProvider
  keyPreview: string
  updatedAt: string
  storageMode: 'plain' | 'legacy-encrypted'
}

export type UnlockedAiIntegration = {
  provider: AiProvider
  apiKey: string
}

type SetupAiIntegrationInput = {
  provider: AiProvider
  apiKey: string
}

type ReplaceAiIntegrationInput = {
  provider: AiProvider
  apiKey: string
}

const AI_INTEGRATION_KEY = 'ai-integration'
const LEGACY_KDF_ITERATIONS_FALLBACK = 200_000
const PIN_PATTERN = /^\d{4}$/

let unlockedAiIntegration: UnlockedAiIntegration | null = null
let unlockedAiIntegrationUpdatedAt: string | null = null

export async function readAiIntegrationMetadata(): Promise<AiIntegrationMetadata | null> {
  const stored = await readStoredAiIntegration()
  syncUnlockedAiIntegrationWithStoredRecord(stored)

  return stored ? toAiIntegrationMetadata(stored) : null
}

export function getUnlockedAiIntegration(): UnlockedAiIntegration | null {
  return unlockedAiIntegration ? { ...unlockedAiIntegration } : null
}

export function isAiIntegrationUnlocked() {
  return unlockedAiIntegration !== null
}

export function lockAiIntegration() {
  unlockedAiIntegration = null
  unlockedAiIntegrationUpdatedAt = null
}

export async function setupAiIntegration(input: SetupAiIntegrationInput): Promise<AiIntegrationMetadata> {
  assertValidApiKey(input.apiKey)

  const stored = createPlainStoredAiIntegration({
    provider: input.provider,
    apiKey: input.apiKey.trim()
  })

  await writeClientValue(AI_INTEGRATION_KEY, stored)
  syncUnlockedAiIntegrationWithStoredRecord(stored)

  return toAiIntegrationMetadata(stored)
}

export async function unlockAiIntegration(pin: string): Promise<AiIntegrationMetadata> {
  const stored = await readStoredAiIntegration()

  if (!stored) {
    throw new Error('No AI integration is configured yet.')
  }

  if (stored.version === 2) {
    syncUnlockedAiIntegrationWithStoredRecord(stored)
    return toAiIntegrationMetadata(stored)
  }

  assertValidPin(pin)
  const apiKey = await decryptLegacyApiKey(stored, pin)
  const migrated = createPlainStoredAiIntegration({
    provider: stored.provider,
    apiKey
  })

  await writeClientValue(AI_INTEGRATION_KEY, migrated)
  syncUnlockedAiIntegrationWithStoredRecord(migrated)

  return toAiIntegrationMetadata(migrated)
}

export async function clearAiIntegration() {
  lockAiIntegration()
  await writeClientValue<null>(AI_INTEGRATION_KEY, null)
}

export async function replaceAiIntegration(input: ReplaceAiIntegrationInput): Promise<AiIntegrationMetadata> {
  assertValidApiKey(input.apiKey)

  const stored = createPlainStoredAiIntegration({
    provider: input.provider,
    apiKey: input.apiKey.trim()
  })

  await writeClientValue(AI_INTEGRATION_KEY, stored)
  syncUnlockedAiIntegrationWithStoredRecord(stored)

  return toAiIntegrationMetadata(stored)
}

export function isValidAiPin(pin: string) {
  return PIN_PATTERN.test(pin.trim())
}

async function readStoredAiIntegration(): Promise<StoredAiIntegrationRecord | null> {
  const value = await readClientValue<unknown>(AI_INTEGRATION_KEY)
  return normalizeStoredAiIntegration(value)
}

function normalizeStoredAiIntegration(value: unknown): StoredAiIntegrationRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>

  if (record.version === 2) {
    return normalizePlainStoredAiIntegration(record)
  }

  return normalizeLegacyStoredAiIntegration(record)
}

function normalizePlainStoredAiIntegration(value: Record<string, unknown>): StoredAiIntegrationV2 | null {
  if (value.provider !== 'openai' && value.provider !== 'anthropic') {
    return null
  }

  if (typeof value.apiKey !== 'string' || !value.apiKey.trim()) {
    return null
  }

  const updatedAt = normalizeUpdatedAt(value.updatedAt)

  if (!updatedAt) {
    return null
  }

  return {
    version: 2,
    provider: value.provider,
    apiKey: value.apiKey.trim(),
    updatedAt
  }
}

function normalizeLegacyStoredAiIntegration(value: Record<string, unknown>): LegacyStoredAiIntegrationV1 | null {
  if (value.version !== 1) {
    return null
  }

  if (value.provider !== 'openai' && value.provider !== 'anthropic') {
    return null
  }

  if (
    typeof value.keyPreview !== 'string'
    || typeof value.encryptedApiKey !== 'string'
    || typeof value.salt !== 'string'
    || typeof value.iv !== 'string'
  ) {
    return null
  }

  const kdf = normalizeLegacyKdf(value.kdf)
  const keyUpdatedAt = normalizeUpdatedAt(
    typeof value.keyUpdatedAt === 'string'
      ? value.keyUpdatedAt
      : value.updatedAt
  )

  if (!kdf || !keyUpdatedAt) {
    return null
  }

  return {
    version: 1,
    provider: value.provider,
    keyPreview: value.keyPreview,
    encryptedApiKey: value.encryptedApiKey,
    salt: value.salt,
    iv: value.iv,
    kdf,
    keyUpdatedAt
  }
}

function normalizeLegacyKdf(value: unknown): LegacyStoredAiIntegrationV1['kdf'] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const iterations = typeof record.iterations === 'number' && Number.isFinite(record.iterations) && record.iterations > 0
    ? Math.round(record.iterations)
    : LEGACY_KDF_ITERATIONS_FALLBACK

  if (record.name !== 'PBKDF2' || record.hash !== 'SHA-256') {
    return null
  }

  return {
    name: 'PBKDF2',
    hash: 'SHA-256',
    iterations
  }
}

function createPlainStoredAiIntegration(input: {
  provider: AiProvider
  apiKey: string
}): StoredAiIntegrationV2 {
  return {
    version: 2,
    provider: input.provider,
    apiKey: input.apiKey.trim(),
    updatedAt: new Date().toISOString()
  }
}

function toAiIntegrationMetadata(stored: StoredAiIntegrationRecord): AiIntegrationMetadata {
  if (stored.version === 2) {
    return {
      provider: stored.provider,
      keyPreview: buildKeyPreview(stored.apiKey),
      updatedAt: stored.updatedAt,
      storageMode: 'plain'
    }
  }

  return {
    provider: stored.provider,
    keyPreview: stored.keyPreview,
    updatedAt: stored.keyUpdatedAt,
    storageMode: 'legacy-encrypted'
  }
}

async function decryptLegacyApiKey(record: LegacyStoredAiIntegrationV1, pin: string): Promise<string> {
  try {
    const key = await deriveLegacyEncryptionKey(
      pin,
      base64ToBytes(record.salt),
      record.kdf.iterations
    )
    const plaintext = await getCryptoApi().subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(record.iv) },
      key,
      base64ToBytes(record.encryptedApiKey)
    )

    const apiKey = new TextDecoder().decode(new Uint8Array(plaintext)).trim()

    if (!apiKey) {
      throw new Error('Empty decrypted key.')
    }

    return apiKey
  } catch {
    throw new Error('Invalid legacy encryption password.')
  }
}

async function deriveLegacyEncryptionKey(pin: string, salt: Uint8Array, iterations: number) {
  const cryptoApi = getCryptoApi()
  const passwordKey = await cryptoApi.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveKey']
  )

  return cryptoApi.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations,
      hash: 'SHA-256'
    },
    passwordKey,
    {
      name: 'AES-GCM',
      length: 256
    },
    false,
    ['decrypt']
  )
}

function assertValidPin(pin: string) {
  if (!isValidAiPin(pin)) {
    throw new Error('Legacy encryption password must be exactly 4 digits.')
  }
}

function assertValidApiKey(apiKey: string) {
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new Error('API key is required.')
  }
}

function buildKeyPreview(apiKey: string) {
  const trimmed = apiKey.trim()
  return trimmed.slice(0, Math.min(8, trimmed.length))
}

function syncUnlockedAiIntegrationWithStoredRecord(stored: StoredAiIntegrationRecord | null) {
  if (!stored) {
    lockAiIntegration()
    return
  }

  if (stored.version === 2) {
    unlockedAiIntegration = {
      provider: stored.provider,
      apiKey: stored.apiKey
    }
    unlockedAiIntegrationUpdatedAt = stored.updatedAt
    return
  }

  if (!unlockedAiIntegration) {
    return
  }

  if (
    unlockedAiIntegration.provider !== stored.provider
    || unlockedAiIntegrationUpdatedAt !== stored.keyUpdatedAt
  ) {
    lockAiIntegration()
  }
}

function normalizeUpdatedAt(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const timestamp = Date.parse(value.trim())

  if (Number.isNaN(timestamp)) {
    return null
  }

  return new Date(timestamp).toISOString()
}

function getCryptoApi() {
  if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
    throw new Error('Web Crypto API is unavailable in this browser.')
  }

  return window.crypto
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const start = bytes.byteOffset
  const end = bytes.byteOffset + bytes.byteLength
  return bytes.buffer.slice(start, end) as ArrayBuffer
}
