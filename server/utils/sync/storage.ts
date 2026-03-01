import { createHash, randomInt, randomUUID } from 'node:crypto'
import { useStorage } from 'nitropack/runtime'
import {
  type ApproveSyncPairingRequestResponse,
  type AuthorizeSyncPairingRequestResponse,
  areSyncTransportPayloadsEquivalent,
  compareSyncDocumentToCheckpoint,
  compareSyncDocumentsByCheckpoint,
  compareSyncDocumentsLww,
  type CreateSyncPairingRequestResponse,
  createSyncCheckpoint,
  type GetSyncVaultKeyResponse,
  type GetSyncPairingRequestStatusResponse,
  normalizeSyncCheckpoint,
  normalizeSyncTransportPayload,
  normalizeSyncVaultKeyRecord,
  SYNC_TRANSPORT_MODE_PLAINTEXT_DEV,
  type PutSyncVaultKeyRequest,
  type CreateSyncVaultResponse,
  type RegisterSyncDeviceResponse,
  type SyncDeviceRecord,
  type SyncPullResponse,
  type SyncPushResponse,
  type SyncPullCheckpoint,
  type SyncPushRow,
  type SyncPairingCredentialsPayload,
  type SyncTransportPayload,
  type SyncTransportMode,
  type SyncVaultKeyRecord,
  type SyncVaultMetadataResponse,
  type SyncableCollectionName
} from '#shared/utils/sync/protocol'

type StoredSyncVault = {
  vaultId: string
  tokenHash: string
  transportMode: SyncTransportMode
  createdAt: string
  updatedAt: string
}

type StoredSyncDevice = SyncDeviceRecord

type StoredSyncDoc = {
  vaultId: string
  collectionName: SyncableCollectionName
  documentId: string
  document: SyncTransportPayload
  createdAt: string
  appliedAt: string
}

type StoredSyncVaultKey = SyncVaultKeyRecord & {
  vaultId: string
}

type CreateSyncVaultInput = {
  deviceId: string
  deviceName: string
  transportMode: SyncTransportMode
}

type StoredSyncPairingRequest = {
  pairingId: string
  pairingSecretHash: string
  pairingCode: string
  requesterDeviceId: string
  requesterDeviceName: string
  createdAt: string
  expiresAt: string
  approvedAt: string | null
  credentials: SyncPairingCredentialsPayload | null
}

const SYNC_STORAGE_BASE = 'sync/v1'
const SYNC_PAIRING_REQUEST_TTL_MS = 10 * 60 * 1000
const SYNC_PAIRING_CODE_LENGTH = 6
const SYNC_PAIRING_CODE_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const MAX_SYNC_PAIRING_CODE_ATTEMPTS = 32

export async function createSyncVault(input: CreateSyncVaultInput): Promise<CreateSyncVaultResponse> {
  const vaultId = randomUUID()
  const vaultToken = randomUUID()
  const nowIso = new Date().toISOString()

  await getSyncStorage().setItem<StoredSyncVault>(vaultStorageKey(vaultId), {
    vaultId,
    tokenHash: hashVaultToken(vaultToken),
    transportMode: input.transportMode,
    createdAt: nowIso,
    updatedAt: nowIso
  })

  await upsertSyncDevice(vaultId, {
    deviceId: input.deviceId,
    deviceName: input.deviceName,
    createdAt: nowIso,
    lastSeenAt: nowIso
  })

  return {
    vaultId,
    vaultToken,
    transportMode: input.transportMode,
    createdAt: nowIso
  }
}

export async function createPlaintextSyncVault(input: Omit<CreateSyncVaultInput, 'transportMode'>): Promise<CreateSyncVaultResponse> {
  return createSyncVault({
    ...input,
    transportMode: SYNC_TRANSPORT_MODE_PLAINTEXT_DEV
  })
}

export async function getSyncVaultMetadata(vaultId: string): Promise<SyncVaultMetadataResponse | null> {
  const vault = await getSyncStorage().getItem<StoredSyncVault>(vaultStorageKey(vaultId))

  if (!vault) {
    return null
  }

  return {
    vaultId: vault.vaultId,
    transportMode: vault.transportMode,
    createdAt: vault.createdAt,
    updatedAt: vault.updatedAt
  }
}

export async function authenticateSyncVault(vaultId: string, vaultToken: string): Promise<SyncVaultMetadataResponse | null> {
  const vault = await getSyncStorage().getItem<StoredSyncVault>(vaultStorageKey(vaultId))

  if (!vault) {
    return null
  }

  if (vault.tokenHash !== hashVaultToken(vaultToken)) {
    return null
  }

  return {
    vaultId: vault.vaultId,
    transportMode: vault.transportMode,
    createdAt: vault.createdAt,
    updatedAt: vault.updatedAt
  }
}

export async function registerSyncDevice(vaultId: string, deviceId: string, deviceName: string): Promise<RegisterSyncDeviceResponse> {
  const existing = await getSyncStorage().getItem<StoredSyncDevice>(deviceStorageKey(vaultId, deviceId))
  const nowIso = new Date().toISOString()

  const next: StoredSyncDevice = existing
    ? {
        ...existing,
        deviceName,
        lastSeenAt: nowIso
      }
    : {
        deviceId,
        deviceName,
        createdAt: nowIso,
        lastSeenAt: nowIso
      }

  await upsertSyncDevice(vaultId, next)

  return {
    device: next
  }
}

export async function listSyncDevices(vaultId: string): Promise<SyncDeviceRecord[]> {
  const keys = await getSyncStorage().getKeys(deviceStoragePrefix(vaultId))
  const devices = await Promise.all(
    keys.map((key: string) => getSyncStorage().getItem<StoredSyncDevice>(key))
  )

  return devices
    .filter((device: StoredSyncDevice | null): device is StoredSyncDevice => Boolean(device))
    .sort((left: StoredSyncDevice, right: StoredSyncDevice) => left.deviceName.localeCompare(right.deviceName) || left.deviceId.localeCompare(right.deviceId))
}

export async function getSyncVaultKey(vaultId: string): Promise<GetSyncVaultKeyResponse | null> {
  const keyRecord = await getSyncStorage().getItem<StoredSyncVaultKey>(vaultKeyStorageKey(vaultId))

  if (!keyRecord) {
    return null
  }

  return stripStoredSyncVaultKey(keyRecord)
}

export async function putSyncVaultKey(vaultId: string, value: PutSyncVaultKeyRequest): Promise<GetSyncVaultKeyResponse> {
  const normalized = normalizeSyncVaultKeyRecord(value)

  if (!normalized) {
    throw new Error('Invalid sync vault key payload.')
  }

  await getSyncStorage().setItem<StoredSyncVaultKey>(vaultKeyStorageKey(vaultId), {
    vaultId,
    ...normalized
  })

  await touchSyncVault(vaultId, normalized.updatedAt)

  return normalized
}

export async function deleteSyncVault(vaultId: string): Promise<void> {
  await deleteStorageKeysWithPrefix(collectionStorageRootPrefix(vaultId))
  await deleteStorageKeysWithPrefix(deviceStoragePrefix(vaultId))
  await getSyncStorage().removeItem(vaultKeyStorageKey(vaultId))
  await getSyncStorage().removeItem(vaultStorageKey(vaultId))
}

export async function pullSyncDocuments(input: {
  vaultId: string
  transportMode: SyncTransportMode
  collectionName: SyncableCollectionName
  checkpoint?: SyncPullCheckpoint
  batchSize: number
}): Promise<SyncPullResponse> {
  const documents = (await readSyncCollectionDocuments(input.vaultId, input.collectionName))
    .filter((document: StoredSyncDoc) => Boolean(normalizeSyncTransportPayload(document.document, input.transportMode)))
  const filtered = input.checkpoint
    ? documents.filter((document: StoredSyncDoc) => compareSyncDocumentToCheckpoint(document.document, input.checkpoint!) > 0)
    : documents
  const limited = filtered.slice(0, Math.max(1, Math.min(input.batchSize, 100)))
  const lastDocument = limited.at(-1)?.document

  return {
    checkpoint: lastDocument
      ? createSyncCheckpoint(lastDocument)
      : input.checkpoint,
    documents: limited.map(document => document.document)
  }
}

export async function pushSyncDocuments(input: {
  vaultId: string
  transportMode: SyncTransportMode
  collectionName: SyncableCollectionName
  rows: SyncPushRow[]
}): Promise<SyncPushResponse['conflicts']> {
  const conflicts: SyncPushResponse['conflicts'] = []

  for (const row of input.rows) {
    const incoming = normalizeSyncTransportPayload(row.newDocumentState, input.transportMode)

    if (!incoming) {
      continue
    }

    const key = documentStorageKey(input.vaultId, input.collectionName, incoming.id)
    const existing = await getSyncStorage().getItem<StoredSyncDoc>(key)
    const current = existing?.document ?? null

    if (!current) {
      await upsertSyncDocument(input.vaultId, input.collectionName, incoming, existing?.createdAt)
      continue
    }

    if (areSyncTransportPayloadsEquivalent(current, incoming)) {
      continue
    }

    const assumed = normalizeSyncTransportPayload(row.assumedMasterState, input.transportMode)
    const existingCreatedAt = existing?.createdAt

    if (assumed && areSyncTransportPayloadsEquivalent(current, assumed)) {
      await upsertSyncDocument(input.vaultId, input.collectionName, incoming, existingCreatedAt)
      continue
    }

    const winner = compareSyncDocumentsLww(incoming, current) >= 0 ? incoming : current

    if (areSyncTransportPayloadsEquivalent(winner, current)) {
      conflicts.push(current)
      continue
    }

    await upsertSyncDocument(input.vaultId, input.collectionName, incoming, existingCreatedAt)
  }

  return conflicts
}

export function normalizeRequestedCheckpoint(value: unknown) {
  return normalizeSyncCheckpoint(value)
}

export async function createSyncPairingRequest(input: {
  requesterDeviceId: string
  requesterDeviceName: string
}): Promise<CreateSyncPairingRequestResponse> {
  const pairingId = randomUUID()
  const pairingSecret = randomUUID()
  const pairingCode = await createUniqueSyncPairingCode()
  const createdAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + SYNC_PAIRING_REQUEST_TTL_MS).toISOString()

  await getSyncStorage().setItem<StoredSyncPairingRequest>(pairingRequestStorageKey(pairingId), {
    pairingId,
    pairingSecretHash: hashPairingSecret(pairingSecret),
    pairingCode,
    requesterDeviceId: input.requesterDeviceId,
    requesterDeviceName: input.requesterDeviceName,
    createdAt,
    expiresAt,
    approvedAt: null,
    credentials: null
  })
  await getSyncStorage().setItem<string>(pairingCodeStorageKey(pairingCode), pairingId)

  return {
    pairingId,
    pairingSecret,
    pairingCode,
    requesterDeviceId: input.requesterDeviceId,
    requesterDeviceName: input.requesterDeviceName,
    createdAt,
    expiresAt
  }
}

export async function getSyncPairingRequestStatus(input: {
  pairingId: string
  pairingSecret: string
}): Promise<GetSyncPairingRequestStatusResponse | null> {
  const request = await getSyncStorage().getItem<StoredSyncPairingRequest>(pairingRequestStorageKey(input.pairingId))

  if (!request) {
    return null
  }

  if (request.pairingSecretHash !== hashPairingSecret(input.pairingSecret)) {
    return null
  }

  if (isExpiredIso(request.expiresAt)) {
    return {
      pairingId: request.pairingId,
      pairingCode: request.pairingCode,
      requesterDeviceId: request.requesterDeviceId,
      requesterDeviceName: request.requesterDeviceName,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
      status: 'expired'
    }
  }

  return {
    pairingId: request.pairingId,
    pairingCode: request.pairingCode,
    requesterDeviceId: request.requesterDeviceId,
    requesterDeviceName: request.requesterDeviceName,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    status: request.credentials ? 'approved' : 'pending',
    credentials: request.credentials ?? undefined
  }
}

export async function approveSyncPairingRequest(input: {
  pairingId: string
  pairingSecret: string
  vaultId: string
  vaultToken: string
  transportMode: SyncTransportMode
  createdAt: string
}): Promise<ApproveSyncPairingRequestResponse | null> {
  const key = pairingRequestStorageKey(input.pairingId)
  const request = await getSyncStorage().getItem<StoredSyncPairingRequest>(key)

  if (!request) {
    return null
  }

  if (request.pairingSecretHash !== hashPairingSecret(input.pairingSecret)) {
    return null
  }

  if (isExpiredIso(request.expiresAt)) {
    return {
      pairingId: request.pairingId,
      pairingCode: request.pairingCode,
      requesterDeviceId: request.requesterDeviceId,
      requesterDeviceName: request.requesterDeviceName,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
      status: 'expired'
    }
  }

  const approvedAt = new Date().toISOString()
  const credentials: SyncPairingCredentialsPayload = {
    vaultId: input.vaultId,
    vaultToken: input.vaultToken,
    transportMode: input.transportMode,
    createdAt: input.createdAt
  }

  await getSyncStorage().setItem<StoredSyncPairingRequest>(key, {
    ...request,
    approvedAt,
    credentials
  })

  return {
    pairingId: request.pairingId,
    pairingCode: request.pairingCode,
    requesterDeviceId: request.requesterDeviceId,
    requesterDeviceName: request.requesterDeviceName,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    status: 'approved',
    credentials
  }
}

export async function authorizeSyncPairingRequest(input: {
  pairingCode: string
  vaultId: string
  vaultToken: string
  transportMode: SyncTransportMode
  createdAt: string
}): Promise<AuthorizeSyncPairingRequestResponse | null> {
  const pairingId = await getSyncStorage().getItem<string>(pairingCodeStorageKey(input.pairingCode))

  if (!pairingId) {
    return null
  }

  const request = await getSyncStorage().getItem<StoredSyncPairingRequest>(pairingRequestStorageKey(pairingId))

  if (!request || request.pairingCode !== input.pairingCode) {
    return null
  }

  if (isExpiredIso(request.expiresAt)) {
    return {
      pairingId: request.pairingId,
      pairingCode: request.pairingCode,
      requesterDeviceId: request.requesterDeviceId,
      requesterDeviceName: request.requesterDeviceName,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
      status: 'expired'
    }
  }

  const approvedAt = new Date().toISOString()
  const credentials: SyncPairingCredentialsPayload = {
    vaultId: input.vaultId,
    vaultToken: input.vaultToken,
    transportMode: input.transportMode,
    createdAt: input.createdAt
  }

  await getSyncStorage().setItem<StoredSyncPairingRequest>(pairingRequestStorageKey(request.pairingId), {
    ...request,
    approvedAt,
    credentials
  })

  return {
    pairingId: request.pairingId,
    pairingCode: request.pairingCode,
    requesterDeviceId: request.requesterDeviceId,
    requesterDeviceName: request.requesterDeviceName,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    status: 'approved',
    credentials
  }
}

function getSyncStorage() {
  return useStorage('data')
}

function hashVaultToken(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function hashPairingSecret(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function vaultStorageKey(vaultId: string) {
  return `${SYNC_STORAGE_BASE}/vaults/${vaultId}`
}

function deviceStoragePrefix(vaultId: string) {
  return `${SYNC_STORAGE_BASE}/devices/${vaultId}`
}

function deviceStorageKey(vaultId: string, deviceId: string) {
  return `${deviceStoragePrefix(vaultId)}/${deviceId}`
}

function vaultKeyStorageKey(vaultId: string) {
  return `${SYNC_STORAGE_BASE}/keys/${vaultId}`
}

function collectionStoragePrefix(vaultId: string, collectionName: SyncableCollectionName) {
  return `${SYNC_STORAGE_BASE}/docs/${vaultId}/${collectionName}`
}

function collectionStorageRootPrefix(vaultId: string) {
  return `${SYNC_STORAGE_BASE}/docs/${vaultId}`
}

function documentStorageKey(vaultId: string, collectionName: SyncableCollectionName, documentId: string) {
  return `${collectionStoragePrefix(vaultId, collectionName)}/${documentId}`
}

function pairingRequestStorageKey(pairingId: string) {
  return `${SYNC_STORAGE_BASE}/pairing/${pairingId}`
}

function pairingCodeStorageKey(pairingCode: string) {
  return `${SYNC_STORAGE_BASE}/pairing-code/${pairingCode}`
}

async function upsertSyncDevice(vaultId: string, device: StoredSyncDevice) {
  await getSyncStorage().setItem(deviceStorageKey(vaultId, device.deviceId), device)
}

async function upsertSyncDocument(
  vaultId: string,
  collectionName: SyncableCollectionName,
  document: SyncTransportPayload,
  createdAt?: string
) {
  const nowIso = new Date().toISOString()

  await getSyncStorage().setItem<StoredSyncDoc>(documentStorageKey(vaultId, collectionName, document.id), {
    vaultId,
    collectionName,
    documentId: document.id,
    document,
    createdAt: createdAt ?? nowIso,
    appliedAt: nowIso
  })

  await touchSyncVault(vaultId, nowIso)
}

async function readSyncCollectionDocuments(vaultId: string, collectionName: SyncableCollectionName) {
  const keys = await getSyncStorage().getKeys(collectionStoragePrefix(vaultId, collectionName))
  const docs = await Promise.all(
    keys.map((key: string) => getSyncStorage().getItem<StoredSyncDoc>(key))
  )

  return docs
    .filter((document: StoredSyncDoc | null): document is StoredSyncDoc => Boolean(document))
    .sort((left: StoredSyncDoc, right: StoredSyncDoc) => compareSyncDocumentsByCheckpoint(left.document, right.document))
}

function stripStoredSyncVaultKey(value: StoredSyncVaultKey): SyncVaultKeyRecord {
  const { vaultId: _vaultId, ...rest } = value
  return rest
}

async function deleteStorageKeysWithPrefix(prefix: string) {
  const keys = await getSyncStorage().getKeys(prefix)
  await Promise.all(keys.map((key: string) => getSyncStorage().removeItem(key)))
}

async function touchSyncVault(vaultId: string, updatedAt: string) {
  const key = vaultStorageKey(vaultId)
  const vault = await getSyncStorage().getItem<StoredSyncVault>(key)

  if (!vault) {
    return
  }

  await getSyncStorage().setItem<StoredSyncVault>(key, {
    ...vault,
    updatedAt
  })
}

function isExpiredIso(value: string) {
  return Date.parse(value) <= Date.now()
}

async function createUniqueSyncPairingCode() {
  for (let attempt = 0; attempt < MAX_SYNC_PAIRING_CODE_ATTEMPTS; attempt += 1) {
    const pairingCode = randomSyncPairingCode()
    const existingPairingId = await getSyncStorage().getItem<string>(pairingCodeStorageKey(pairingCode))

    if (!existingPairingId) {
      return pairingCode
    }

    const existingRequest = await getSyncStorage().getItem<StoredSyncPairingRequest>(pairingRequestStorageKey(existingPairingId))

    if (!existingRequest || isExpiredIso(existingRequest.expiresAt)) {
      return pairingCode
    }
  }

  throw new Error('Could not allocate a unique sync pairing code.')
}

function randomSyncPairingCode() {
  let value = ''

  for (let index = 0; index < SYNC_PAIRING_CODE_LENGTH; index += 1) {
    value += SYNC_PAIRING_CODE_CHARSET[randomInt(SYNC_PAIRING_CODE_CHARSET.length)] ?? '0'
  }

  return value
}
