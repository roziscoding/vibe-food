export const SYNC_API_BASE = '/api/sync/v1'
export const SYNC_VAULT_ID_HEADER = 'x-sync-vault-id'
export const SYNC_DEVICE_ID_HEADER = 'x-sync-device-id'
export const SYNC_TRANSPORT_MODE_PLAINTEXT_DEV = 'plaintext-dev' as const
export const SYNC_TRANSPORT_MODE_E2EE_V1 = 'e2ee-v1' as const
export const SYNC_ENCRYPTION_VERSION_V1 = 1 as const
export const SYNC_ENCRYPTION_ALGORITHM_A256GCM = 'A256GCM' as const
export const SYNC_KDF_NAME_PBKDF2 = 'PBKDF2' as const
export const SYNC_KDF_HASH_SHA256 = 'SHA-256' as const

export const SYNCABLE_COLLECTION_NAMES = ['ingredients', 'meals', 'settings', 'ai-integration'] as const

export type SyncableCollectionName = (typeof SYNCABLE_COLLECTION_NAMES)[number]
export type SyncTransportMode
  = | typeof SYNC_TRANSPORT_MODE_PLAINTEXT_DEV
    | typeof SYNC_TRANSPORT_MODE_E2EE_V1
export type SyncEncryptionVersion = typeof SYNC_ENCRYPTION_VERSION_V1
export type SyncEncryptionAlgorithm = typeof SYNC_ENCRYPTION_ALGORITHM_A256GCM
export type SyncKdfName = typeof SYNC_KDF_NAME_PBKDF2
export type SyncKdfHash = typeof SYNC_KDF_HASH_SHA256

export interface SyncDocumentMetadata {
  id: string
  updatedAt: string
  deletedAt: string | null
  lastModifiedByDeviceId: string
  syncVersion: string
  _deleted?: boolean
}

export interface SyncTransportDocument extends SyncDocumentMetadata {
  [key: string]: unknown
}

export interface SyncEncryptedTransportDocument extends SyncDocumentMetadata {
  encVersion: SyncEncryptionVersion
  alg: SyncEncryptionAlgorithm
  iv: string
  ciphertext: string
  keyVersion: string
  schemaVersion: number
}

export type SyncTransportPayload = SyncTransportDocument | SyncEncryptedTransportDocument

export interface SyncPullCheckpoint {
  updatedAt: string
  lastModifiedByDeviceId: string
  syncVersion: string
  id: string
}

export interface SyncVaultKeyRecord {
  wrappedMasterKey: string
  wrappingIv: string
  salt: string
  kdf: {
    name: SyncKdfName
    hash: SyncKdfHash
    iterations: number
  }
  keyVersion: string
  updatedAt: string
}

export interface SyncPushRow {
  assumedMasterState?: SyncTransportPayload
  newDocumentState: SyncTransportPayload
}

export interface CreateSyncVaultRequest {
  deviceId: string
  deviceName?: string
  transportMode?: SyncTransportMode
}

export interface CreateSyncVaultResponse {
  vaultId: string
  vaultToken: string
  transportMode: SyncTransportMode
  createdAt: string
}

export interface SyncVaultMetadataResponse {
  vaultId: string
  transportMode: SyncTransportMode
  createdAt: string
  updatedAt: string
}

export interface RegisterSyncDeviceRequest {
  deviceId: string
  deviceName?: string
}

export interface SyncDeviceRecord {
  deviceId: string
  deviceName: string
  createdAt: string
  lastSeenAt: string
}

export interface RegisterSyncDeviceResponse {
  device: SyncDeviceRecord
}

export interface ListSyncDevicesResponse {
  devices: SyncDeviceRecord[]
}

export type GetSyncVaultKeyResponse = SyncVaultKeyRecord
export type PutSyncVaultKeyRequest = SyncVaultKeyRecord
export type PutSyncVaultKeyResponse = SyncVaultKeyRecord

export interface SyncPullRequest {
  checkpoint?: SyncPullCheckpoint | null
  batchSize?: number
}

export interface SyncPullResponse {
  checkpoint?: SyncPullCheckpoint
  documents: SyncTransportPayload[]
}

export interface SyncPushRequest {
  rows: SyncPushRow[]
}

export interface SyncPushResponse {
  conflicts: SyncTransportPayload[]
}

export interface CreateSyncPairingRequestRequest {
  requesterDeviceId: string
  requesterDeviceName?: string
}

export interface CreateSyncPairingRequestResponse {
  pairingId: string
  pairingSecret: string
  pairingCode: string
  requesterDeviceId: string
  requesterDeviceName: string
  createdAt: string
  expiresAt: string
}

export interface ApproveSyncPairingRequestRequest {
  pairingSecret: string
}

export interface AuthorizeSyncPairingRequestRequest {
  pairingCode: string
}

export interface SyncPairingCredentialsPayload {
  vaultId: string
  vaultToken: string
  transportMode: SyncTransportMode
  createdAt: string
}

export type SyncPairingRequestStatus = 'pending' | 'approved' | 'expired'

export interface GetSyncPairingRequestStatusResponse {
  pairingId: string
  pairingCode: string
  requesterDeviceId: string
  requesterDeviceName: string
  createdAt: string
  expiresAt: string
  status: SyncPairingRequestStatus
  credentials?: SyncPairingCredentialsPayload
}

export type ApproveSyncPairingRequestResponse = GetSyncPairingRequestStatusResponse
export type AuthorizeSyncPairingRequestResponse = GetSyncPairingRequestStatusResponse

export function isSyncableCollectionName(value: string): value is SyncableCollectionName {
  return (SYNCABLE_COLLECTION_NAMES as readonly string[]).includes(value)
}

export function isSyncTransportMode(value: unknown): value is SyncTransportMode {
  return value === SYNC_TRANSPORT_MODE_PLAINTEXT_DEV || value === SYNC_TRANSPORT_MODE_E2EE_V1
}

export function normalizeSyncTransportDocument(value: unknown): SyncTransportDocument | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>

  if (normalizeSyncEncryptedTransportDocument(record)) {
    return null
  }

  const metadata = normalizeSyncDocumentMetadataRecord(record)

  if (!metadata) {
    return null
  }

  return {
    ...record,
    ...metadata
  }
}

export function normalizeSyncEncryptedTransportDocument(value: unknown): SyncEncryptedTransportDocument | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const metadata = normalizeSyncDocumentMetadataRecord(record)
  const iv = normalizeString(record.iv)
  const ciphertext = normalizeString(record.ciphertext)
  const keyVersion = normalizeString(record.keyVersion)
  const schemaVersion = normalizePositiveInteger(record.schemaVersion)

  if (!metadata || record.encVersion !== SYNC_ENCRYPTION_VERSION_V1 || record.alg !== SYNC_ENCRYPTION_ALGORITHM_A256GCM) {
    return null
  }

  if (!iv || !ciphertext || !keyVersion || schemaVersion === null) {
    return null
  }

  return {
    ...metadata,
    encVersion: SYNC_ENCRYPTION_VERSION_V1,
    alg: SYNC_ENCRYPTION_ALGORITHM_A256GCM,
    iv,
    ciphertext,
    keyVersion,
    schemaVersion
  }
}

export function isSyncEncryptedTransportDocument(value: unknown): value is SyncEncryptedTransportDocument {
  return normalizeSyncEncryptedTransportDocument(value) !== null
}

export function normalizeSyncTransportPayload(
  value: unknown,
  transportMode: SyncTransportMode
): SyncTransportPayload | null {
  switch (transportMode) {
    case SYNC_TRANSPORT_MODE_PLAINTEXT_DEV:
      return normalizeSyncTransportDocument(value)
    case SYNC_TRANSPORT_MODE_E2EE_V1:
      return normalizeSyncEncryptedTransportDocument(value)
    default:
      return null
  }
}

export function normalizeSyncVaultKeyRecord(value: unknown): SyncVaultKeyRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const wrappedMasterKey = normalizeString(record.wrappedMasterKey)
  const wrappingIv = normalizeString(record.wrappingIv)
  const salt = normalizeString(record.salt)
  const keyVersion = normalizeString(record.keyVersion)
  const updatedAt = normalizeIsoString(record.updatedAt)
  const kdf = normalizeSyncVaultKeyKdf(record.kdf)

  if (!wrappedMasterKey || !wrappingIv || !salt || !keyVersion || !updatedAt || !kdf) {
    return null
  }

  return {
    wrappedMasterKey,
    wrappingIv,
    salt,
    kdf,
    keyVersion,
    updatedAt
  }
}

export function normalizeSyncCheckpoint(value: unknown): SyncPullCheckpoint | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const record = value as Record<string, unknown>
  const updatedAt = normalizeIsoString(record.updatedAt)
  const lastModifiedByDeviceId = normalizeString(record.lastModifiedByDeviceId)
  const syncVersion = normalizeString(record.syncVersion)
  const id = normalizeString(record.id)

  if (!updatedAt || !lastModifiedByDeviceId || !syncVersion || !id) {
    return undefined
  }

  return {
    updatedAt,
    lastModifiedByDeviceId,
    syncVersion,
    id
  }
}

export function createSyncCheckpoint(document: Pick<SyncDocumentMetadata, 'updatedAt' | 'lastModifiedByDeviceId' | 'syncVersion' | 'id'>): SyncPullCheckpoint {
  return {
    updatedAt: document.updatedAt,
    lastModifiedByDeviceId: document.lastModifiedByDeviceId,
    syncVersion: document.syncVersion,
    id: document.id
  }
}

export function compareSyncDocumentsByCheckpoint(
  left: Pick<SyncDocumentMetadata, 'updatedAt' | 'lastModifiedByDeviceId' | 'syncVersion' | 'id'>,
  right: Pick<SyncDocumentMetadata, 'updatedAt' | 'lastModifiedByDeviceId' | 'syncVersion' | 'id'>
) {
  return compareSyncCheckpoint(
    createSyncCheckpoint(left),
    createSyncCheckpoint(right)
  )
}

export function compareSyncCheckpoint(left: SyncPullCheckpoint, right: SyncPullCheckpoint) {
  return compareStringTuple(
    [left.updatedAt, left.lastModifiedByDeviceId, left.syncVersion, left.id],
    [right.updatedAt, right.lastModifiedByDeviceId, right.syncVersion, right.id]
  )
}

export function compareSyncDocumentsLww(left: SyncDocumentMetadata, right: SyncDocumentMetadata) {
  return compareStringTuple(
    [left.updatedAt, left.lastModifiedByDeviceId, left.syncVersion, left.id],
    [right.updatedAt, right.lastModifiedByDeviceId, right.syncVersion, right.id]
  )
}

export function areSyncDocumentsEquivalent(left: SyncTransportDocument, right: SyncTransportDocument) {
  return stableSerialize(left) === stableSerialize(right)
}

export function areSyncTransportPayloadsEquivalent(left: SyncTransportPayload, right: SyncTransportPayload) {
  if (isSyncEncryptedTransportDocument(left) && isSyncEncryptedTransportDocument(right)) {
    return areSyncEncryptedTransportDocumentsEquivalent(left, right)
  }

  if (!isSyncEncryptedTransportDocument(left) && !isSyncEncryptedTransportDocument(right)) {
    return areSyncDocumentsEquivalent(left, right)
  }

  return false
}

export function compareSyncDocumentToCheckpoint(
  document: Pick<SyncDocumentMetadata, 'updatedAt' | 'lastModifiedByDeviceId' | 'syncVersion' | 'id'>,
  checkpoint: SyncPullCheckpoint
) {
  return compareSyncCheckpoint(createSyncCheckpoint(document), checkpoint)
}

function compareStringTuple(left: string[], right: string[]) {
  const length = Math.max(left.length, right.length)

  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? ''
    const rightValue = right[index] ?? ''

    if (leftValue === rightValue) {
      continue
    }

    return leftValue < rightValue ? -1 : 1
  }

  return 0
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeSyncDocumentMetadataRecord(value: Record<string, unknown>): SyncDocumentMetadata | null {
  if (!isNonEmptyString(value.id)) {
    return null
  }

  const updatedAt = normalizeIsoString(value.updatedAt)
  const lastModifiedByDeviceId = normalizeString(value.lastModifiedByDeviceId)
  const syncVersion = normalizeString(value.syncVersion)

  if (!updatedAt || !lastModifiedByDeviceId || !syncVersion) {
    return null
  }

  const rawDeletedAt = normalizeNullableIsoString(value.deletedAt)
  const isDeleted = value._deleted === true || rawDeletedAt !== null
  const deletedAt = isDeleted ? (rawDeletedAt ?? updatedAt) : null

  return {
    id: value.id.trim(),
    updatedAt,
    deletedAt,
    lastModifiedByDeviceId,
    syncVersion,
    _deleted: isDeleted
  }
}

function normalizeSyncVaultKeyKdf(value: unknown): SyncVaultKeyRecord['kdf'] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const iterations = normalizePositiveInteger(record.iterations)

  if (record.name !== SYNC_KDF_NAME_PBKDF2 || record.hash !== SYNC_KDF_HASH_SHA256 || iterations === null) {
    return null
  }

  return {
    name: SYNC_KDF_NAME_PBKDF2,
    hash: SYNC_KDF_HASH_SHA256,
    iterations
  }
}

function areSyncEncryptedTransportDocumentsEquivalent(
  left: SyncEncryptedTransportDocument,
  right: SyncEncryptedTransportDocument
) {
  return (
    left.id === right.id
    && left.updatedAt === right.updatedAt
    && left.deletedAt === right.deletedAt
    && left.lastModifiedByDeviceId === right.lastModifiedByDeviceId
    && left.syncVersion === right.syncVersion
    && left.keyVersion === right.keyVersion
    && left.schemaVersion === right.schemaVersion
    && left.encVersion === right.encVersion
    && left.alg === right.alg
  )
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed || null
}

function normalizeIsoString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  if (!trimmed) {
    return null
  }

  const timestamp = Date.parse(trimmed)
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString()
}

function normalizeNullableIsoString(value: unknown): string | null {
  if (value == null) {
    return null
  }

  return normalizeIsoString(value)
}

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }

  return Math.round(value)
}
