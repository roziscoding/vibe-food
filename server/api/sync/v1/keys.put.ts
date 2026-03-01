import { createError, defineEventHandler, readBody } from 'h3'
import { requireAuthenticatedSyncVault } from '#server/utils/sync/http'
import { putSyncVaultKey } from '#server/utils/sync/storage'
import {
  type PutSyncVaultKeyRequest,
  normalizeSyncVaultKeyRecord,
  SYNC_TRANSPORT_MODE_E2EE_V1
} from '#shared/utils/sync/protocol'

export default defineEventHandler(async (event) => {
  const { vault, vaultId } = await requireAuthenticatedSyncVault(event)

  if (vault.transportMode !== SYNC_TRANSPORT_MODE_E2EE_V1) {
    throw createError({
      statusCode: 409,
      statusMessage: 'This sync vault does not use encrypted key exchange.'
    })
  }

  const body = await readBody<PutSyncVaultKeyRequest>(event)

  if (!normalizeSyncVaultKeyRecord(body)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid sync vault key payload.'
    })
  }

  return putSyncVaultKey(vaultId, body)
})
