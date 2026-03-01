import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { requireAuthenticatedSyncVault } from '#server/utils/sync/http'
import { approveSyncPairingRequest } from '#server/utils/sync/storage'
import {
  SYNC_TRANSPORT_MODE_E2EE_V1,
  type ApproveSyncPairingRequestRequest
} from '#shared/utils/sync/protocol'

export default defineEventHandler(async (event) => {
  const { vault, vaultId, vaultToken } = await requireAuthenticatedSyncVault(event)

  if (vault.transportMode !== SYNC_TRANSPORT_MODE_E2EE_V1) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Device linking is only available for encrypted sync vaults.'
    })
  }

  const pairingId = getRouterParam(event, 'pairingId')
  const body = await readBody<ApproveSyncPairingRequestRequest>(event)
  const pairingSecret = normalizeRequiredString(body?.pairingSecret)

  if (!pairingId || !pairingSecret) {
    throw createError({
      statusCode: 400,
      statusMessage: 'pairingId and pairingSecret are required.'
    })
  }

  const result = await approveSyncPairingRequest({
    pairingId,
    pairingSecret,
    vaultId,
    vaultToken,
    transportMode: vault.transportMode,
    createdAt: vault.createdAt
  })

  if (!result) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Pairing request not found.'
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
