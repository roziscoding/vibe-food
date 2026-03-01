import {
  normalizeSyncEncryptedTransportDocument,
  normalizeSyncTransportDocument,
  normalizeSyncVaultKeyRecord,
  SYNC_API_BASE,
  SYNC_DEVICE_ID_HEADER,
  SYNC_ENCRYPTION_ALGORITHM_A256GCM,
  SYNC_ENCRYPTION_VERSION_V1,
  SYNC_KDF_HASH_SHA256,
  SYNC_KDF_NAME_PBKDF2,
  SYNC_VAULT_ID_HEADER,
  type GetSyncVaultKeyResponse,
  type PutSyncVaultKeyRequest,
  type PutSyncVaultKeyResponse,
  type SyncEncryptedTransportDocument,
  type SyncTransportDocument,
  type SyncVaultKeyRecord,
  type SyncableCollectionName
} from '#shared/utils/sync/protocol'
import { createSyncHttpError } from './errors'

type SyncVaultAuth = {
  vaultId: string
  vaultToken: string
}

const SYNC_MASTER_KEY_LENGTH_BITS = 256
const SYNC_WRAPPING_IV_LENGTH_BYTES = 12
const SYNC_PAYLOAD_IV_LENGTH_BYTES = 12
const SYNC_KDF_SALT_LENGTH_BYTES = 16
const SYNC_VAULT_KEY_KDF_ITERATIONS = 310_000
const SYNC_DOCUMENT_SCHEMA_VERSION = 1

export async function createSyncVaultKeyRecord(passphrase: string): Promise<{
  keyRecord: SyncVaultKeyRecord
  masterKey: CryptoKey
}> {
  assertPassphrase(passphrase)

  const cryptoApi = getCryptoApi()
  const salt = cryptoApi.getRandomValues(new Uint8Array(SYNC_KDF_SALT_LENGTH_BYTES))
  const wrappingIv = cryptoApi.getRandomValues(new Uint8Array(SYNC_WRAPPING_IV_LENGTH_BYTES))
  const masterKey = await cryptoApi.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: SYNC_MASTER_KEY_LENGTH_BITS
    },
    true,
    ['encrypt', 'decrypt']
  )
  const wrappingKey = await deriveWrappingKey(passphrase, salt, SYNC_VAULT_KEY_KDF_ITERATIONS)
  const exportedMasterKey = new Uint8Array(await cryptoApi.subtle.exportKey('raw', masterKey))
  const wrappedMasterKey = await cryptoApi.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: wrappingIv
    },
    wrappingKey,
    exportedMasterKey
  )

  return {
    masterKey,
    keyRecord: {
      wrappedMasterKey: bytesToBase64(new Uint8Array(wrappedMasterKey)),
      wrappingIv: bytesToBase64(wrappingIv),
      salt: bytesToBase64(salt),
      kdf: {
        name: SYNC_KDF_NAME_PBKDF2,
        hash: SYNC_KDF_HASH_SHA256,
        iterations: SYNC_VAULT_KEY_KDF_ITERATIONS
      },
      keyVersion: createLocalKeyVersion(),
      updatedAt: new Date().toISOString()
    }
  }
}

export async function unwrapSyncVaultKeyRecord(
  keyRecord: SyncVaultKeyRecord,
  passphrase: string
): Promise<CryptoKey> {
  const normalized = normalizeSyncVaultKeyRecord(keyRecord)

  if (!normalized) {
    throw new Error('Invalid sync vault key metadata.')
  }

  assertPassphrase(passphrase)

  try {
    const wrappingKey = await deriveWrappingKey(
      passphrase,
      base64ToBytes(normalized.salt),
      normalized.kdf.iterations
    )
    const rawMasterKey = await getCryptoApi().subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64ToBytes(normalized.wrappingIv)
      },
      wrappingKey,
      base64ToBytes(normalized.wrappedMasterKey)
    )

    return getCryptoApi().subtle.importKey(
      'raw',
      rawMasterKey,
      {
        name: 'AES-GCM',
        length: SYNC_MASTER_KEY_LENGTH_BITS
      },
      false,
      ['encrypt', 'decrypt']
    )
  } catch {
    throw new Error('Invalid sync passphrase.')
  }
}

export async function fetchSyncVaultKeyRecord(
  auth: SyncVaultAuth,
  deviceId?: string
): Promise<GetSyncVaultKeyResponse> {
  const response = await fetch(`${SYNC_API_BASE}/keys`, {
    method: 'GET',
    headers: buildSyncKeyHeaders(auth, deviceId)
  })

  if (!response.ok) {
    throw await createSyncHttpError(response, 'Could not fetch the encrypted sync key.')
  }

  const payload = normalizeSyncVaultKeyRecord(await response.json())

  if (!payload) {
    throw new Error('Sync vault key response was invalid.')
  }

  return payload
}

export async function putSyncVaultKeyRecord(
  auth: SyncVaultAuth,
  keyRecord: PutSyncVaultKeyRequest,
  deviceId?: string
): Promise<PutSyncVaultKeyResponse> {
  const normalized = normalizeSyncVaultKeyRecord(keyRecord)

  if (!normalized) {
    throw new Error('Invalid sync vault key payload.')
  }

  const response = await fetch(`${SYNC_API_BASE}/keys`, {
    method: 'PUT',
    headers: buildSyncKeyHeaders(auth, deviceId),
    body: JSON.stringify(normalized)
  })

  if (!response.ok) {
    throw await createSyncHttpError(response, 'Could not store the encrypted sync key.')
  }

  const payload = normalizeSyncVaultKeyRecord(await response.json())

  if (!payload) {
    throw new Error('Stored sync vault key response was invalid.')
  }

  return payload
}

export async function encryptSyncTransportDocument(input: {
  document: SyncTransportDocument
  vaultId: string
  collectionName: SyncableCollectionName
  masterKey: CryptoKey
  keyVersion: string
  schemaVersion?: number
}): Promise<SyncEncryptedTransportDocument> {
  const document = normalizeSyncTransportDocument(input.document)

  if (!document) {
    throw new Error('Could not normalize a sync document before encryption.')
  }

  const keyVersion = typeof input.keyVersion === 'string' ? input.keyVersion.trim() : ''

  if (!keyVersion) {
    throw new Error('Encrypted sync payloads require a key version.')
  }

  const schemaVersion = normalizeSchemaVersion(input.schemaVersion)
  const iv = getCryptoApi().getRandomValues(new Uint8Array(SYNC_PAYLOAD_IV_LENGTH_BYTES))
  const plaintext = new TextEncoder().encode(JSON.stringify(document))
  const ciphertext = await getCryptoApi().subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: buildSyncEnvelopeAdditionalData({
        vaultId: input.vaultId,
        collectionName: input.collectionName,
        document,
        schemaVersion
      })
    },
    input.masterKey,
    plaintext
  )

  return {
    id: document.id,
    updatedAt: document.updatedAt,
    deletedAt: document.deletedAt,
    lastModifiedByDeviceId: document.lastModifiedByDeviceId,
    syncVersion: document.syncVersion,
    _deleted: document._deleted,
    encVersion: SYNC_ENCRYPTION_VERSION_V1,
    alg: SYNC_ENCRYPTION_ALGORITHM_A256GCM,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    keyVersion,
    schemaVersion
  }
}

export async function decryptSyncTransportDocument(input: {
  document: SyncEncryptedTransportDocument
  vaultId: string
  collectionName: SyncableCollectionName
  masterKey: CryptoKey
  expectedKeyVersion?: string
}): Promise<SyncTransportDocument> {
  const envelope = normalizeSyncEncryptedTransportDocument(input.document)

  if (!envelope) {
    throw new Error('Could not normalize an encrypted sync payload.')
  }

  if (
    typeof input.expectedKeyVersion === 'string'
    && input.expectedKeyVersion.trim()
    && envelope.keyVersion !== input.expectedKeyVersion.trim()
  ) {
    throw new Error('This device does not have the correct encrypted sync key version.')
  }

  try {
    const plaintext = await getCryptoApi().subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64ToBytes(envelope.iv),
        additionalData: buildSyncEnvelopeAdditionalData({
          vaultId: input.vaultId,
          collectionName: input.collectionName,
          document: envelope,
          schemaVersion: envelope.schemaVersion
        })
      },
      input.masterKey,
      base64ToBytes(envelope.ciphertext)
    )
    const parsed = JSON.parse(new TextDecoder().decode(new Uint8Array(plaintext)))
    const document = normalizeSyncTransportDocument(parsed)

    if (!document) {
      throw new Error('Encrypted sync payload did not contain a valid document.')
    }

    if (
      document.id !== envelope.id
      || document.updatedAt !== envelope.updatedAt
      || document.deletedAt !== envelope.deletedAt
      || document.lastModifiedByDeviceId !== envelope.lastModifiedByDeviceId
      || document.syncVersion !== envelope.syncVersion
    ) {
      throw new Error('Encrypted sync payload metadata did not match the decrypted document.')
    }

    return document
  } catch (error) {
    if (
      error instanceof Error
      && (
        error.message.startsWith('Encrypted sync payload')
        || error.message.startsWith('This device does not have')
      )
    ) {
      throw error
    }

    throw new Error('Could not decrypt an encrypted sync payload.')
  }
}

async function deriveWrappingKey(passphrase: string, salt: Uint8Array, iterations: number) {
  const cryptoApi = getCryptoApi()
  const passwordKey = await cryptoApi.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
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
      length: SYNC_MASTER_KEY_LENGTH_BITS
    },
    false,
    ['encrypt', 'decrypt']
  )
}

function buildSyncEnvelopeAdditionalData(input: {
  vaultId: string
  collectionName: SyncableCollectionName
  document: Pick<SyncTransportDocument, 'id' | 'syncVersion'>
  schemaVersion: number
}) {
  return new TextEncoder().encode(JSON.stringify({
    vaultId: input.vaultId,
    collection: input.collectionName,
    id: input.document.id,
    syncVersion: input.document.syncVersion,
    schemaVersion: input.schemaVersion
  }))
}

function buildSyncKeyHeaders(auth: SyncVaultAuth, deviceId?: string) {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${auth.vaultToken}`,
    [SYNC_VAULT_ID_HEADER]: auth.vaultId
  })

  if (deviceId) {
    headers.set(SYNC_DEVICE_ID_HEADER, deviceId)
  }

  return headers
}

function normalizeSchemaVersion(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return SYNC_DOCUMENT_SCHEMA_VERSION
  }

  return Math.round(value)
}

function assertPassphrase(value: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('A sync passphrase is required.')
  }
}

function createLocalKeyVersion() {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  return `sync-key-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
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
