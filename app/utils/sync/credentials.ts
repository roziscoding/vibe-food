import { readClientValue, writeClientValue } from '../client-db'
import { createSyncVaultKeyRecord, putSyncVaultKeyRecord } from './e2ee'
import { createSyncHttpError } from './errors'
import {
  SYNC_API_BASE,
  SYNC_DEVICE_ID_HEADER,
  isSyncTransportMode,
  SYNC_TRANSPORT_MODE_E2EE_V1,
  SYNC_VAULT_ID_HEADER,
  type CreateSyncVaultRequest,
  type CreateSyncVaultResponse,
  type ListSyncDevicesResponse,
  type RegisterSyncDeviceRequest,
  type RegisterSyncDeviceResponse,
  type SyncDeviceRecord,
  type SyncTransportMode
} from '#shared/utils/sync/protocol'

export interface LocalSyncVaultCredentials {
  version: 1
  vaultId: string
  vaultToken: string
  transportMode: SyncTransportMode
  createdAt: string
}

type LocalSyncVaultPassphrase = {
  version: 1
  vaultId: string
  passphrase: string
  updatedAt: string
}

const LOCAL_SYNC_VAULT_CREDENTIALS_KEY = 'sync-vault-credentials-v1'
const LOCAL_SYNC_VAULT_PASSPHRASE_KEY = 'sync-vault-passphrase-v1'

export async function readLocalSyncVaultCredentials(): Promise<LocalSyncVaultCredentials | null> {
  const stored = await readClientValue<unknown>(LOCAL_SYNC_VAULT_CREDENTIALS_KEY)

  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return null
  }

  const record = stored as Partial<LocalSyncVaultCredentials>

  if (record.version !== 1) {
    return null
  }

  if (!isNonEmptyString(record.vaultId) || !isNonEmptyString(record.vaultToken) || !isNonEmptyString(record.createdAt)) {
    return null
  }

  if (!isSyncTransportMode(record.transportMode)) {
    return null
  }

  return {
    version: 1,
    vaultId: record.vaultId.trim(),
    vaultToken: record.vaultToken.trim(),
    transportMode: record.transportMode,
    createdAt: record.createdAt.trim()
  }
}

export async function writeLocalSyncVaultCredentials(credentials: LocalSyncVaultCredentials): Promise<void> {
  await writeClientValue(LOCAL_SYNC_VAULT_CREDENTIALS_KEY, normalizeLocalSyncVaultCredentials(credentials))
}

export async function clearLocalSyncVaultCredentials(): Promise<void> {
  await writeClientValue(LOCAL_SYNC_VAULT_CREDENTIALS_KEY, null)
}

export async function readLocalSyncVaultPassphrase(vaultId: string): Promise<string | null> {
  const stored = await readClientValue<unknown>(LOCAL_SYNC_VAULT_PASSPHRASE_KEY)

  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return null
  }

  const record = stored as Partial<LocalSyncVaultPassphrase>

  if (
    record.version !== 1
    || !isNonEmptyString(record.vaultId)
    || !hasNonEmptySecret(record.passphrase)
    || record.vaultId.trim() !== vaultId
  ) {
    return null
  }

  return record.passphrase
}

export async function writeLocalSyncVaultPassphrase(input: {
  vaultId: string
  passphrase: string
}): Promise<void> {
  if (!isNonEmptyString(input.vaultId) || !hasNonEmptySecret(input.passphrase)) {
    throw new Error('A vault ID and sync passphrase are required.')
  }

  await writeClientValue<LocalSyncVaultPassphrase>(LOCAL_SYNC_VAULT_PASSPHRASE_KEY, {
    version: 1,
    vaultId: input.vaultId.trim(),
    passphrase: input.passphrase,
    updatedAt: new Date().toISOString()
  })
}

export async function clearLocalSyncVaultPassphrase(): Promise<void> {
  await writeClientValue<null>(LOCAL_SYNC_VAULT_PASSPHRASE_KEY, null)
}

export async function ensureDevelopmentSyncVault(input: {
  deviceId: string
  deviceName?: string
}): Promise<LocalSyncVaultCredentials | null> {
  const existing = await readLocalSyncVaultCredentials()

  if (existing) {
    return existing
  }

  if (!import.meta.dev) {
    return null
  }

  const response = await postJson<CreateSyncVaultRequest, CreateSyncVaultResponse>(`${SYNC_API_BASE}/vaults`, {
    deviceId: input.deviceId,
    deviceName: input.deviceName
  })

  const credentials: LocalSyncVaultCredentials = {
    version: 1,
    vaultId: response.vaultId,
    vaultToken: response.vaultToken,
    transportMode: response.transportMode,
    createdAt: response.createdAt
  }

  await writeLocalSyncVaultCredentials(credentials)
  return credentials
}

export async function createEncryptedSyncVault(input: {
  deviceId: string
  deviceName?: string
  passphrase: string
}): Promise<LocalSyncVaultCredentials> {
  const response = await postJson<CreateSyncVaultRequest, CreateSyncVaultResponse>(`${SYNC_API_BASE}/vaults`, {
    deviceId: input.deviceId,
    deviceName: input.deviceName,
    transportMode: SYNC_TRANSPORT_MODE_E2EE_V1
  })

  if (response.transportMode !== SYNC_TRANSPORT_MODE_E2EE_V1) {
    throw new Error('The sync server did not create an encrypted vault.')
  }

  const credentials: LocalSyncVaultCredentials = {
    version: 1,
    vaultId: response.vaultId,
    vaultToken: response.vaultToken,
    transportMode: response.transportMode,
    createdAt: response.createdAt
  }
  const { keyRecord } = await createSyncVaultKeyRecord(input.passphrase)

  await putSyncVaultKeyRecord(credentials, keyRecord, input.deviceId)
  await writeLocalSyncVaultCredentials(credentials)
  await writeLocalSyncVaultPassphrase({
    vaultId: credentials.vaultId,
    passphrase: input.passphrase
  })

  return credentials
}

export async function registerLocalSyncDevice(input: {
  credentials: LocalSyncVaultCredentials
  deviceId: string
  deviceName?: string
}): Promise<RegisterSyncDeviceResponse> {
  return postJson<RegisterSyncDeviceRequest, RegisterSyncDeviceResponse>(
    `${SYNC_API_BASE}/devices`,
    {
      deviceId: input.deviceId,
      deviceName: input.deviceName
    },
    buildSyncAuthHeaders(input.credentials, input.deviceId)
  )
}

export async function listLocalSyncDevices(input: {
  credentials: LocalSyncVaultCredentials
  deviceId?: string
}): Promise<SyncDeviceRecord[]> {
  const response = await fetch(`${SYNC_API_BASE}/devices`, {
    method: 'GET',
    headers: buildSyncAuthHeaders(input.credentials, input.deviceId)
  })

  if (!response.ok) {
    throw await createSyncHttpError(response, 'Could not load synced devices.')
  }

  const payload = await response.json() as ListSyncDevicesResponse
  return Array.isArray(payload.devices) ? payload.devices : []
}

export async function deleteRemoteSyncVault(input: {
  credentials: LocalSyncVaultCredentials
  deviceId?: string
}): Promise<void> {
  const response = await fetch(`${SYNC_API_BASE}/vaults/${encodeURIComponent(input.credentials.vaultId)}`, {
    method: 'DELETE',
    headers: buildSyncAuthHeaders(input.credentials, input.deviceId)
  })

  if (!response.ok) {
    throw await createSyncHttpError(response, 'Could not delete the cloud sync copy.')
  }
}

export function buildSyncAuthHeaders(credentials: Pick<LocalSyncVaultCredentials, 'vaultId' | 'vaultToken'>, deviceId?: string) {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${credentials.vaultToken}`,
    [SYNC_VAULT_ID_HEADER]: credentials.vaultId
  })

  if (deviceId) {
    headers.set(SYNC_DEVICE_ID_HEADER, deviceId)
  }

  return headers
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function hasNonEmptySecret(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeLocalSyncVaultCredentials(value: unknown): LocalSyncVaultCredentials {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid local sync vault credentials.')
  }

  const record = value as Partial<LocalSyncVaultCredentials>

  if (record.version !== 1) {
    throw new Error('Unsupported local sync vault credential version.')
  }

  if (!isNonEmptyString(record.vaultId) || !isNonEmptyString(record.vaultToken) || !isNonEmptyString(record.createdAt)) {
    throw new Error('Incomplete local sync vault credentials.')
  }

  if (!isSyncTransportMode(record.transportMode)) {
    throw new Error('Unsupported local sync transport mode.')
  }

  return {
    version: 1,
    vaultId: record.vaultId.trim(),
    vaultToken: record.vaultToken.trim(),
    transportMode: record.transportMode,
    createdAt: record.createdAt.trim()
  }
}

async function postJson<TRequest, TResponse>(
  input: string,
  body: TRequest,
  headers?: Headers
): Promise<TResponse> {
  const response = await fetch(input, {
    method: 'POST',
    headers: headers ?? new Headers({
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    throw await createSyncHttpError(response, 'Sync request failed.')
  }

  return response.json() as Promise<TResponse>
}
