import { createError, defineEventHandler, getQuery, getRouterParam } from 'h3'
import { getSyncPairingRequestStatus } from '#server/utils/sync/storage'

export default defineEventHandler(async (event) => {
  const pairingId = getRouterParam(event, 'pairingId')
  const pairingSecret = normalizeRequiredString(getQuery(event).pairingSecret)

  if (!pairingId || !pairingSecret) {
    throw createError({
      statusCode: 400,
      statusMessage: 'pairingId and pairingSecret are required.'
    })
  }

  const status = await getSyncPairingRequestStatus({
    pairingId,
    pairingSecret
  })

  if (!status) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Pairing request not found.'
    })
  }

  return status
})

function normalizeRequiredString(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed || null
}
