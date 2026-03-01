import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { requireAuthenticatedSyncVault } from '#server/utils/sync/http'
import { pushSyncDocuments } from '#server/utils/sync/storage'
import { isSyncableCollectionName, type SyncPushRequest } from '#shared/utils/sync/protocol'

export default defineEventHandler(async (event) => {
  const { vault, vaultId } = await requireAuthenticatedSyncVault(event)
  const collectionParam = getRouterParam(event, 'collection')

  if (!collectionParam || !isSyncableCollectionName(collectionParam)) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Unknown sync collection.'
    })
  }

  const body = await readBody<SyncPushRequest>(event)
  const rows = Array.isArray(body?.rows) ? body.rows : []

  if (rows.length === 0) {
    return {
      conflicts: []
    }
  }

  return {
    conflicts: await pushSyncDocuments({
      vaultId,
      transportMode: vault.transportMode,
      collectionName: collectionParam,
      rows
    })
  }
})
