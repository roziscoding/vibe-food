import { createError, defineEventHandler, readBody } from 'h3'
import { createSyncPairingRequest } from '#server/utils/sync/storage'
import type { CreateSyncPairingRequestRequest } from '#shared/utils/sync/protocol'

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateSyncPairingRequestRequest>(event)
  const requesterDeviceId = normalizeRequiredString(body?.requesterDeviceId)

  if (!requesterDeviceId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'requesterDeviceId is required.'
    })
  }

  return createSyncPairingRequest({
    requesterDeviceId,
    requesterDeviceName: normalizeOptionalString(body?.requesterDeviceName) ?? 'Unnamed device'
  })
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
