import { createError, defineEventHandler, readBody } from 'h3'
import { requireAuthenticatedSyncVault } from '#server/utils/sync/http'
import { authorizeSyncPairingRequest } from '#server/utils/sync/storage'
import {
  SYNC_TRANSPORT_MODE_E2EE_V1,
  type AuthorizeSyncPairingRequestRequest
} from '#shared/utils/sync/protocol'

export default defineEventHandler(async (event) => {
  const { vault, vaultId, vaultToken } = await requireAuthenticatedSyncVault(event)

  if (vault.transportMode !== SYNC_TRANSPORT_MODE_E2EE_V1) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Device linking is only available for encrypted sync vaults.'
    })
  }

  const body = await readBody<AuthorizeSyncPairingRequestRequest>(event)
  const pairingCode = normalizeRequiredString(body?.pairingCode)

  if (!pairingCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'pairingCode is required.'
    })
  }

  const result = await authorizeSyncPairingRequest({
    pairingCode,
    vaultId,
    vaultToken,
    transportMode: vault.transportMode,
    createdAt: vault.createdAt
  })

  if (!result) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Pairing code not found.'
    })
  }

  return result
})

function normalizeRequiredString(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed || null
}
