import { defineEventHandler } from 'h3'
import { requireAuthenticatedSyncVault } from '#server/utils/sync/http'
import { listSyncDevices } from '#server/utils/sync/storage'

export default defineEventHandler(async (event) => {
  const { vaultId } = await requireAuthenticatedSyncVault(event)

  return {
    devices: await listSyncDevices(vaultId)
  }
})
