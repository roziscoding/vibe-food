import { readClientValue, writeClientValue } from './client-db'
import type { AiProvider } from './client-settings'

type StoredAiIntegrationV1 = {
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
  updatedAt: string
}

export type AiIntegrationMetadata = {
  provider: AiProvider
  keyPreview: string
  updatedAt: string
}

export type UnlockedAiIntegration = {
  provider: AiProvider
  apiKey: string
}

type SetupAiIntegrationInput = {
  provider: AiProvider
  apiKey: string
  pin: string
}

type ChangeAiIntegrationPasswordInput = {
  currentPin: string
  newPin: string
}

type ReplaceAiIntegrationInput = {
  provider: AiProvider
  apiKey: string
  currentPin: string
}

const AI_INTEGRATION_KEY = 'ai-integration'
const KDF_ITERATIONS = 200_000
const PIN_PATTERN = /^\d{4}$/

let unlockedAiIntegration: UnlockedAiIntegration | null = null

export async function readAiIntegrationMetadata(): Promise<AiIntegrationMetadata | null> {
  const stored = await readStoredAiIntegration()

  if (!stored) {
    return null
  }

  return {
    provider: stored.provider,
    keyPreview: stored.keyPreview,
    updatedAt: stored.updatedAt
  }
}

export function getUnlockedAiIntegration(): UnlockedAiIntegration | null {
  return unlockedAiIntegration ? { ...unlockedAiIntegration } : null
}

export function isAiIntegrationUnlocked() {
  return unlockedAiIntegration !== null
}

export function lockAiIntegration() {
  unlockedAiIntegration = null
}

export async function setupAiIntegration(input: SetupAiIntegrationInput): Promise<AiIntegrationMetadata> {
  assertValidPin(input.pin)
  assertValidApiKey(input.apiKey)

  const stored = await encryptApiKey({
    provider: input.provider,
    apiKey: input.apiKey.trim(),
    pin: input.pin
  })

  await writeClientValue(AI_INTEGRATION_KEY, stored)
  unlockedAiIntegration = {
    provider: input.provider,
    apiKey: input.apiKey.trim()
  }

  return {
    provider: stored.provider,
    keyPreview: stored.keyPreview,
    updatedAt: stored.updatedAt
  }
}

export async function unlockAiIntegration(pin: string): Promise<AiIntegrationMetadata> {
  assertValidPin(pin)

  const stored = await readStoredAiIntegration()

  if (!stored) {
    throw new Error('No AI integration is configured yet.')
  }

  const apiKey = await decryptApiKey(stored, pin)

  unlockedAiIntegration = {
    provider: stored.provider,
    apiKey
  }

  return {
    provider: stored.provider,
    keyPreview: stored.keyPreview,
    updatedAt: stored.updatedAt
  }
}

export async function clearAiIntegration() {
  unlockedAiIntegration = null
  await writeClientValue<null>(AI_INTEGRATION_KEY, null)
}

export async function changeAiIntegrationPassword(input: ChangeAiIntegrationPasswordInput): Promise<AiIntegrationMetadata> {
  assertValidPin(input.currentPin)
  assertValidPin(input.newPin)

  const stored = await readStoredAiIntegration()

  if (!stored) {
    throw new Error('No AI integration is configured yet.')
  }

  const apiKey = await decryptApiKey(stored, input.currentPin)
  const reencrypted = await encryptApiKey({
    provider: stored.provider,
    apiKey,
    pin: input.newPin
  })

  await writeClientValue(AI_INTEGRATION_KEY, reencrypted)
  unlockedAiIntegration = {
    provider: stored.provider,
    apiKey
  }

  return {
    provider: reencrypted.provider,
    keyPreview: reencrypted.keyPreview,
    updatedAt: reencrypted.updatedAt
  }
}

export async function replaceAiIntegration(input: ReplaceAiIntegrationInput): Promise<AiIntegrationMetadata> {
  assertValidPin(input.currentPin)
  assertValidApiKey(input.apiKey)

  const stored = await readStoredAiIntegration()

  if (!stored) {
    throw new Error('No AI integration is configured yet.')
  }

  // Verify the current pin against the existing encrypted key before replacing.
  await decryptApiKey(stored, input.currentPin)

  const nextStored = await encryptApiKey({
    provider: input.provider,
    apiKey: input.apiKey.trim(),
    pin: input.currentPin
  })

  await writeClientValue(AI_INTEGRATION_KEY, nextStored)
  unlockedAiIntegration = {
    provider: input.provider,
    apiKey: input.apiKey.trim()
  }

  return {
    provider: nextStored.provider,
    keyPreview: nextStored.keyPreview,
    updatedAt: nextStored.updatedAt
  }
}

export function isValidAiPin(pin: string) {
  return PIN_PATTERN.test(pin.trim())
}

async function readStoredAiIntegration(): Promise<StoredAiIntegrationV1 | null> {
  const value = await readClientValue<unknown>(AI_INTEGRATION_KEY)
  return normalizeStoredAiIntegration(value)
}

function normalizeStoredAiIntegration(value: unknown): StoredAiIntegrationV1 | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Partial<StoredAiIntegrationV1>

  if (record.version !== 1) {
    return null
  }

  if (record.provider !== 'openai' && record.provider !== 'anthropic') {
    return null
  }

  if (
    typeof record.keyPreview !== 'string'
    || typeof record.encryptedApiKey !== 'string'
    || typeof record.salt !== 'string'
    || typeof record.iv !== 'string'
    || typeof record.updatedAt !== 'string'
  ) {
    return null
  }

  if (
    !record.kdf
    || record.kdf.name !== 'PBKDF2'
    || record.kdf.hash !== 'SHA-256'
    || typeof record.kdf.iterations !== 'number'
    || !Number.isFinite(record.kdf.iterations)
    || record.kdf.iterations <= 0
  ) {
    return null
  }

  return {
    version: 1,
    provider: record.provider,
    keyPreview: record.keyPreview,
    encryptedApiKey: record.encryptedApiKey,
    salt: record.salt,
    iv: record.iv,
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: Math.round(record.kdf.iterations)
    },
    updatedAt: record.updatedAt
  }
}

async function encryptApiKey(input: {
  provider: AiProvider
  apiKey: string
  pin: string
}): Promise<StoredAiIntegrationV1> {
  const cryptoApi = getCryptoApi()
  const salt = cryptoApi.getRandomValues(new Uint8Array(16))
  const iv = cryptoApi.getRandomValues(new Uint8Array(12))
  const key = await deriveEncryptionKey(input.pin, salt, KDF_ITERATIONS)
  const plaintext = new TextEncoder().encode(input.apiKey)
  const ciphertext = await cryptoApi.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  )

  return {
    version: 1,
    provider: input.provider,
    keyPreview: buildKeyPreview(input.apiKey),
    encryptedApiKey: bytesToBase64(new Uint8Array(ciphertext)),
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: KDF_ITERATIONS
    },
    updatedAt: new Date().toISOString()
  }
}

async function decryptApiKey(record: StoredAiIntegrationV1, pin: string): Promise<string> {
  try {
    const key = await deriveEncryptionKey(
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
  }
  catch {
    throw new Error('Invalid encryption password.')
  }
}

async function deriveEncryptionKey(pin: string, salt: Uint8Array, iterations: number) {
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
    ['encrypt', 'decrypt']
  )
}

function assertValidPin(pin: string) {
  if (!isValidAiPin(pin)) {
    throw new Error('Encryption password must be exactly 4 digits.')
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

function getCryptoApi() {
  if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
    throw new Error('Web Crypto API is unavailable in this browser.')
  }

  return window.crypto
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
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
