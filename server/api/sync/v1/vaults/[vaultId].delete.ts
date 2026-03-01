import { createError, defineEventHandler, getRouterParam } from 'h3'
import { requireAuthenticatedSyncVault } from '#server/utils/sync/http'
import { deleteSyncVault, getSyncVaultMetadata } from '#server/utils/sync/storage'

export default defineEventHandler(async (event) => {
  const routeVaultId = getRouterParam(event, 'vaultId')

  if (!routeVaultId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Vault ID is required.'
    })
  }

  const { vaultId } = await requireAuthenticatedSyncVault(event)

  if (vaultId !== routeVaultId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Vault ID does not match authenticated vault.'
    })
  }

  const metadata = await getSyncVaultMetadata(vaultId)

  if (!metadata) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Sync vault not found.'
    })
  }

  await deleteSyncVault(vaultId)

  return {
    vaultId,
    deletedAt: new Date().toISOString()
  }
})
