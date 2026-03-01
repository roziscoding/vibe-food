import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { requireAuthenticatedSyncVault } from '#server/utils/sync/http'
import { normalizeRequestedCheckpoint, pullSyncDocuments } from '#server/utils/sync/storage'
import { isSyncableCollectionName, type SyncPullRequest } from '#shared/utils/sync/protocol'

export default defineEventHandler(async (event) => {
  const { vault, vaultId } = await requireAuthenticatedSyncVault(event)
  const collectionParam = getRouterParam(event, 'collection')

  if (!collectionParam || !isSyncableCollectionName(collectionParam)) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Unknown sync collection.'
    })
  }

  const body = await readBody<SyncPullRequest>(event)
  const batchSize = normalizeBatchSize(body?.batchSize)

  return pullSyncDocuments({
    vaultId,
    transportMode: vault.transportMode,
    collectionName: collectionParam,
    checkpoint: normalizeRequestedCheckpoint(body?.checkpoint),
    batchSize
  })
})

function normalizeBatchSize(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 50
  }

  return Math.max(1, Math.min(Math.round(value), 100))
}
