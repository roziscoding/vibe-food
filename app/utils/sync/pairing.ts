import { SYNC_API_BASE, type AuthorizeSyncPairingRequestRequest, type AuthorizeSyncPairingRequestResponse, type CreateSyncPairingRequestRequest, type CreateSyncPairingRequestResponse, type GetSyncPairingRequestStatusResponse } from '#shared/utils/sync/protocol'
import { buildSyncAuthHeaders } from './credentials'
import type { LocalSyncVaultCredentials } from './credentials'

export interface LocalSyncPairingPayload {
  version: 1
  pairingId: string
  pairingSecret: string
  pairingCode: string
  requesterDeviceId: string
  requesterDeviceName: string
  createdAt: string
  expiresAt: string
}

const LOCAL_SYNC_PAIRING_AUTHORIZE_QUERY_KEY = 'syncAuthorizeCode'

export async function createLocalSyncPairingRequest(input: {
  requesterDeviceId: string
  requesterDeviceName?: string
}): Promise<LocalSyncPairingPayload> {
  const response = await postJson<CreateSyncPairingRequestRequest, CreateSyncPairingRequestResponse>(
    `${SYNC_API_BASE}/pairing/requests`,
    {
      requesterDeviceId: input.requesterDeviceId,
      requesterDeviceName: input.requesterDeviceName
    }
  )

  return {
    version: 1,
    pairingId: response.pairingId,
    pairingSecret: response.pairingSecret,
    pairingCode: response.pairingCode,
    requesterDeviceId: response.requesterDeviceId,
    requesterDeviceName: response.requesterDeviceName,
    createdAt: response.createdAt,
    expiresAt: response.expiresAt
  }
}

export async function getLocalSyncPairingStatus(payload: LocalSyncPairingPayload): Promise<GetSyncPairingRequestStatusResponse> {
  const response = await fetch(`${SYNC_API_BASE}/pairing/requests/${encodeURIComponent(payload.pairingId)}?pairingSecret=${encodeURIComponent(payload.pairingSecret)}`)

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Could not read sync pairing status.'))
  }

  return response.json() as Promise<GetSyncPairingRequestStatusResponse>
}

export async function authorizeLocalSyncPairingRequest(input: {
  pairingCode: string
  credentials: LocalSyncVaultCredentials
  deviceId: string
}): Promise<AuthorizeSyncPairingRequestResponse> {
  return postJson<AuthorizeSyncPairingRequestRequest, AuthorizeSyncPairingRequestResponse>(
    `${SYNC_API_BASE}/pairing/authorize`,
    {
      pairingCode: input.pairingCode
    },
    buildSyncAuthHeaders(input.credentials, input.deviceId)
  )
}

export function buildLocalSyncPairingAuthorizeUrl(pairingCode: string, baseUrl: string) {
  const url = new URL('/settings', baseUrl)
  url.searchParams.set(LOCAL_SYNC_PAIRING_AUTHORIZE_QUERY_KEY, pairingCode)
  return url.toString()
}

export function getLocalSyncPairingAuthorizeQueryKey() {
  return LOCAL_SYNC_PAIRING_AUTHORIZE_QUERY_KEY
}

export function normalizeLocalSyncPairingCode(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  if (!/^[0-9A-Za-z]{6}$/.test(trimmed)) {
    return null
  }

  return trimmed
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
    throw new Error(await readErrorMessage(response, 'Sync pairing request failed.'))
  }

  return response.json() as Promise<TResponse>
}

async function readErrorMessage(response: Response, fallback: string) {
  try {
    const text = await response.text()
    return text.trim() || fallback
  } catch {
    return fallback
  }
}
