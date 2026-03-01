import { createError, defineEventHandler } from 'h3'
import { requireAuthenticatedSyncVault } from '#server/utils/sync/http'
import { getSyncVaultKey } from '#server/utils/sync/storage'
import { SYNC_TRANSPORT_MODE_E2EE_V1 } from '#shared/utils/sync/protocol'

export default defineEventHandler(async (event) => {
  const { vault, vaultId } = await requireAuthenticatedSyncVault(event)

  if (vault.transportMode !== SYNC_TRANSPORT_MODE_E2EE_V1) {
    throw createError({
      statusCode: 409,
      statusMessage: 'This sync vault does not use encrypted key exchange.'
    })
  }

  const keyRecord = await getSyncVaultKey(vaultId)

  if (!keyRecord) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Sync vault key not found.'
    })
  }

  return keyRecord
})
