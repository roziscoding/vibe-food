export const LOCAL_SYNC_ERROR_CODES = [
  'network',
  'auth',
  'server',
  'config',
  'crypto',
  'validation',
  'unknown'
] as const

export type LocalSyncErrorCode = (typeof LOCAL_SYNC_ERROR_CODES)[number]

export type LocalSyncErrorDetails = {
  code: LocalSyncErrorCode
  retryable: boolean
  message: string
}

export class SyncHttpError extends Error {
  readonly status: number
  readonly url?: string

  constructor(message: string, status: number, url?: string) {
    super(message)
    this.name = 'SyncHttpError'
    this.status = status
    this.url = url
  }
}

export function isLocalSyncErrorCode(value: unknown): value is LocalSyncErrorCode {
  return typeof value === 'string' && (LOCAL_SYNC_ERROR_CODES as readonly string[]).includes(value)
}

export async function createSyncHttpError(response: Response, fallback: string): Promise<SyncHttpError> {
  return new SyncHttpError(
    await readSyncErrorMessage(response, fallback),
    response.status,
    response.url || undefined
  )
}

export function classifyLocalSyncError(error: unknown): LocalSyncErrorDetails {
  if (error instanceof SyncHttpError) {
    if (error.status === 401 || error.status === 403) {
      return {
        code: 'auth',
        retryable: false,
        message: error.message
      }
    }

    if (error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500) {
      return {
        code: error.status >= 500 ? 'server' : 'network',
        retryable: true,
        message: error.message
      }
    }

    if (error.status >= 400) {
      return {
        code: 'validation',
        retryable: false,
        message: error.message
      }
    }
  }

  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : 'Sync failed.'
  const normalized = message.trim() || 'Sync failed.'

  if (error instanceof TypeError && /fetch|network|load failed/i.test(normalized)) {
    return {
      code: 'network',
      retryable: true,
      message: normalized
    }
  }

  if (/failed to fetch|fetch failed|network request failed|load failed|networkerror/i.test(normalized)) {
    return {
      code: 'network',
      retryable: true,
      message: normalized
    }
  }

  if (/invalid sync passphrase|could not decrypt an encrypted sync payload|encrypted sync key version|invalid sync vault key metadata|web crypto api is unavailable/i.test(normalized)) {
    return {
      code: 'crypto',
      retryable: false,
      message: normalized
    }
  }

  if (/missing the local sync passphrase|required for the encrypted vault|no sync vault is configured|did not create an encrypted vault|invalid local sync vault credentials|unsupported local sync transport mode|incomplete local sync vault credentials/i.test(normalized)) {
    return {
      code: 'config',
      retryable: false,
      message: normalized
    }
  }

  if (/unauthorized|forbidden|invalid token|authentication/i.test(normalized)) {
    return {
      code: 'auth',
      retryable: false,
      message: normalized
    }
  }

  if (/could not normalize|invalid .*payload|could not serialize|unsupported sync transport mode/i.test(normalized)) {
    return {
      code: 'validation',
      retryable: false,
      message: normalized
    }
  }

  return {
    code: 'unknown',
    retryable: false,
    message: normalized
  }
}

export function formatLocalSyncErrorMessage(details: LocalSyncErrorDetails, retryDelayMs?: number | null) {
  const baseMessage = `${getLocalSyncErrorLabel(details.code)}: ${details.message}`

  if (!details.retryable || !retryDelayMs || retryDelayMs <= 0) {
    return baseMessage
  }

  return `${baseMessage} Retrying in ${formatRetryDelay(retryDelayMs)}.`
}

function getLocalSyncErrorLabel(code: LocalSyncErrorCode) {
  switch (code) {
    case 'network':
      return 'Network error'
    case 'auth':
      return 'Authentication error'
    case 'server':
      return 'Server error'
    case 'config':
      return 'Sync configuration error'
    case 'crypto':
      return 'Sync encryption error'
    case 'validation':
      return 'Sync validation error'
    default:
      return 'Sync error'
  }
}

function formatRetryDelay(delayMs: number) {
  if (delayMs % 60_000 === 0) {
    const minutes = delayMs / 60_000
    return `${minutes} minute${minutes === 1 ? '' : 's'}`
  }

  const seconds = Math.round(delayMs / 1000)
  return `${seconds} second${seconds === 1 ? '' : 's'}`
}

async function readSyncErrorMessage(response: Response, fallback: string) {
  try {
    const text = await response.text()
    return text.trim() || fallback
  } catch {
    return fallback
  }
}
