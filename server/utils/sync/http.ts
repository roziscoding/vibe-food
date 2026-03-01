import { createError, getHeader, type H3Event } from 'h3'
import { authenticateSyncVault } from './storage'
import { SYNC_DEVICE_ID_HEADER, SYNC_VAULT_ID_HEADER } from '#shared/utils/sync/protocol'

export async function requireAuthenticatedSyncVault(event: H3Event) {
  const vaultId = normalizeHeaderValue(getHeader(event, SYNC_VAULT_ID_HEADER))
  const vaultToken = readBearerToken(getHeader(event, 'authorization'))

  if (!vaultId || !vaultToken) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Missing sync vault credentials.'
    })
  }

  const vault = await authenticateSyncVault(vaultId, vaultToken)

  if (!vault) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Invalid sync vault credentials.'
    })
  }

  return {
    vault,
    vaultId,
    vaultToken,
    deviceId: normalizeHeaderValue(getHeader(event, SYNC_DEVICE_ID_HEADER))
  }
}

export function assertDevelopmentPlaintextMode() {
  if (import.meta.dev) {
    return
  }

  throw createError({
    statusCode: 403,
    statusMessage: 'Plaintext sync bootstrap is only available during development.'
  })
}

function readBearerToken(value: string | undefined) {
  if (!value) {
    return null
  }

  const match = value.match(/^Bearer\s+(.+)$/i)

  if (!match) {
    return null
  }

  const token = match[1]?.trim()
  return token || null
}

function normalizeHeaderValue(value: string | undefined) {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  return trimmed || null
}
