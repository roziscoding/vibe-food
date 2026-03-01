import { createError, defineEventHandler, readBody } from 'h3'
import { assertDevelopmentPlaintextMode } from '#server/utils/sync/http'
import { createSyncVault } from '#server/utils/sync/storage'
import {
  type CreateSyncVaultRequest,
  isSyncTransportMode,
  SYNC_TRANSPORT_MODE_E2EE_V1,
  SYNC_TRANSPORT_MODE_PLAINTEXT_DEV
} from '#shared/utils/sync/protocol'

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateSyncVaultRequest>(event)
  const deviceId = normalizeRequiredString(body?.deviceId)

  if (!deviceId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'deviceId is required.'
    })
  }

  if (body?.transportMode != null && !isSyncTransportMode(body.transportMode)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'transportMode is invalid.'
    })
  }

  const requestedTransportMode = normalizeTransportMode(body?.transportMode)

  if (requestedTransportMode === SYNC_TRANSPORT_MODE_PLAINTEXT_DEV) {
    assertDevelopmentPlaintextMode()
  }

  return createSyncVault({
    deviceId,
    deviceName: normalizeOptionalString(body?.deviceName) ?? 'Browser device',
    transportMode: requestedTransportMode
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

function normalizeTransportMode(value: unknown) {
  if (isSyncTransportMode(value)) {
    return value
  }

  return import.meta.dev
    ? SYNC_TRANSPORT_MODE_PLAINTEXT_DEV
    : SYNC_TRANSPORT_MODE_E2EE_V1
}
