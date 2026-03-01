import { createError, defineEventHandler, readBody } from 'h3'
import { requireAuthenticatedSyncVault } from '#server/utils/sync/http'
import { registerSyncDevice } from '#server/utils/sync/storage'
import type { RegisterSyncDeviceRequest } from '#shared/utils/sync/protocol'

export default defineEventHandler(async (event) => {
  const { vaultId } = await requireAuthenticatedSyncVault(event)
  const body = await readBody<RegisterSyncDeviceRequest>(event)
  const deviceId = normalizeRequiredString(body?.deviceId)

  if (!deviceId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'deviceId is required.'
    })
  }

  return registerSyncDevice(
    vaultId,
    deviceId,
    normalizeOptionalString(body?.deviceName) ?? 'Unnamed device'
  )
})

function normalizeRequiredString(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed || null
}

function normalizeOptionalString(value: unknown) {
  return normalizeRequiredString(value)
}
