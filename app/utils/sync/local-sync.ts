import { reactive, readonly } from 'vue'
import { readClientValue, writeClientValue } from '../client-db'
import { clearPhase0LocalSyncableData, readPhase0LocalDeviceId } from '../db/rxdb-phase0'
import {
  clearLocalSyncVaultCredentials,
  clearLocalSyncVaultPassphrase,
  ensureDevelopmentSyncVault,
  registerLocalSyncDevice,
  writeLocalSyncVaultPassphrase,
  writeLocalSyncVaultCredentials
} from './credentials'
import {
  classifyLocalSyncError,
  formatLocalSyncErrorMessage,
  isLocalSyncErrorCode,
  type LocalSyncErrorCode
} from './errors'
import { cancelSyncReplicationRuntime, ensureSyncReplicationRuntime } from './replication'
import { isSyncTransportMode, type SyncTransportMode } from '#shared/utils/sync/protocol'

export type LocalSyncStatus = 'idle' | 'syncing' | 'paused' | 'error'
export type LocalSyncTriggerReason = 'startup' | 'manual' | 'online' | 'visibility' | 'retry'

type StoredLocalSyncState = {
  version: 1
  enabled: boolean
  isPaused: boolean
  vaultId: string | null
  transportMode?: SyncTransportMode | null
  lastSyncAttemptAt: string | null
  lastSyncSuccessAt: string | null
  lastTriggerReason: LocalSyncTriggerReason | null
  lastErrorCode?: LocalSyncErrorCode | null
  lastError: string | null
  nextRetryAt?: string | null
  retryAttemptCount?: number
}

type LocalSyncRuntimeState = {
  initialized: boolean
  started: boolean
  enabled: boolean
  isPaused: boolean
  status: LocalSyncStatus
  vaultId: string | null
  transportMode: SyncTransportMode | null
  deviceId: string | null
  lastSyncAttemptAt: string | null
  lastSyncSuccessAt: string | null
  lastTriggerReason: LocalSyncTriggerReason | null
  lastErrorCode: LocalSyncErrorCode | null
  lastError: string | null
  nextRetryAt: string | null
  retryAttemptCount: number
  lastStateUpdatedAt: string | null
  isOnline: boolean
}

const LOCAL_SYNC_STATE_KEY = 'sync-local-state-v1'
const FALLBACK_DEVICE_ID_WARNING = 'Using a temporary sync device ID until the local database is ready.'
const LOCAL_SYNC_RETRY_BACKOFF_MS = [5_000, 15_000, 30_000, 60_000, 120_000] as const

const defaultState: LocalSyncRuntimeState = {
  initialized: false,
  started: false,
  enabled: false,
  isPaused: false,
  status: 'idle',
  vaultId: null,
  transportMode: null,
  deviceId: null,
  lastSyncAttemptAt: null,
  lastSyncSuccessAt: null,
  lastTriggerReason: null,
  lastErrorCode: null,
  lastError: null,
  nextRetryAt: null,
  retryAttemptCount: 0,
  lastStateUpdatedAt: null,
  isOnline: true
}

const localSyncState = reactive<LocalSyncRuntimeState>({ ...defaultState })

let startPromise: Promise<void> | null = null
let hydratePromise: Promise<void> | null = null
let listenersRegistered = false
let persistPromise: Promise<void> | null = null
let pendingPersist = false
let runPromise: Promise<void> | null = null
let retryTimer: number | null = null

export function useLocalSyncState() {
  return readonly(localSyncState)
}

export async function ensureLocalSyncOrchestratorStarted(): Promise<void> {
  if (typeof window === 'undefined') {
    return
  }

  if (!startPromise) {
    startPromise = (async () => {
      await hydrateLocalSyncState()
      await ensureDeviceId()
      registerLifecycleListeners()
      mutateState({
        started: true,
        isOnline: window.navigator.onLine
      })

      if (localSyncState.enabled && !localSyncState.isPaused) {
        void runLocalSync('startup')
      } else {
        refreshStatus()
      }
    })().catch((error) => {
      startPromise = null
      mutateState({
        started: false,
        status: 'error',
        lastError: error instanceof Error ? error.message : 'Failed to start local sync orchestrator.'
      })
      throw error
    })
  }

  await startPromise
}

export async function setLocalSyncEnabled(enabled: boolean): Promise<void> {
  await ensureLocalSyncOrchestratorStarted()

  mutateState({
    enabled,
    lastErrorCode: null,
    lastError: null,
    nextRetryAt: null,
    retryAttemptCount: 0
  })

  if (!enabled) {
    clearScheduledRetry()
    await cancelSyncReplicationRuntime()
    mutateState({
      isPaused: false,
      lastErrorCode: null,
      nextRetryAt: null,
      retryAttemptCount: 0
    })
    refreshStatus()
    return
  }

  if (!localSyncState.isPaused) {
    void runLocalSync('manual')
  } else {
    refreshStatus()
  }
}

export async function pauseLocalSync(): Promise<void> {
  await ensureLocalSyncOrchestratorStarted()

  if (!localSyncState.enabled) {
    return
  }

  clearScheduledRetry()
  await cancelSyncReplicationRuntime()
  mutateState({
    isPaused: true,
    nextRetryAt: null,
    retryAttemptCount: 0
  })
  refreshStatus()
}

export async function resumeLocalSync(): Promise<void> {
  await ensureLocalSyncOrchestratorStarted()

  if (!localSyncState.enabled) {
    return
  }

  clearScheduledRetry()
  mutateState({
    isPaused: false,
    lastErrorCode: null,
    lastError: null,
    nextRetryAt: null,
    retryAttemptCount: 0
  })

  void runLocalSync('manual')
}

export async function connectLocalSyncToExistingVault(input: {
  vaultId: string
  vaultToken: string
  transportMode: SyncTransportMode
  createdAt: string
  passphrase?: string
}): Promise<void> {
  await ensureLocalSyncOrchestratorStarted()
  await cancelSyncReplicationRuntime()

  // Linking to an existing vault should start from the remote vault state,
  // not merge stale local sync documents from this browser into that vault.
  await clearPhase0LocalSyncableData()

  if (input.transportMode === 'e2ee-v1') {
    if (typeof input.passphrase !== 'string' || input.passphrase.trim().length === 0) {
      throw new Error('Enter the sync passphrase for this encrypted vault before linking the device.')
    }

    await writeLocalSyncVaultPassphrase({
      vaultId: input.vaultId,
      passphrase: input.passphrase
    })
  }

  await writeLocalSyncVaultCredentials({
    version: 1,
    vaultId: input.vaultId,
    vaultToken: input.vaultToken,
    transportMode: input.transportMode,
    createdAt: input.createdAt
  })

  mutateState({
    enabled: true,
    isPaused: false,
    status: 'idle',
    vaultId: input.vaultId,
    transportMode: input.transportMode,
    lastErrorCode: null,
    lastError: null,
    nextRetryAt: null,
    retryAttemptCount: 0
  })

  await runLocalSync('manual')
}

export async function signOutLocalSyncKeepingLocalData(): Promise<void> {
  await ensureLocalSyncOrchestratorStarted()
  clearScheduledRetry()
  await cancelSyncReplicationRuntime()
  await clearLocalSyncVaultCredentials()
  await clearLocalSyncVaultPassphrase()

  mutateState({
    enabled: false,
    isPaused: false,
    status: 'idle',
    vaultId: null,
    transportMode: null,
    lastSyncAttemptAt: null,
    lastSyncSuccessAt: null,
    lastTriggerReason: null,
    lastErrorCode: null,
    lastError: null,
    nextRetryAt: null,
    retryAttemptCount: 0
  })

  refreshStatus()
}

export async function runLocalSync(reason: LocalSyncTriggerReason): Promise<void> {
  await ensureLocalSyncOrchestratorStarted()

  if (runPromise) {
    return runPromise
  }

  runPromise = (async () => {
    if (!localSyncState.enabled) {
      refreshStatus()
      return
    }

    if (localSyncState.isPaused) {
      refreshStatus()
      return
    }

    clearScheduledRetry()
    mutateState({
      status: 'syncing',
      lastErrorCode: null,
      lastError: null,
      nextRetryAt: null,
      lastSyncAttemptAt: new Date().toISOString(),
      lastTriggerReason: reason
    })

    try {
      const deviceId = await ensureDeviceId()
      const deviceName = getLocalSyncDeviceName()
      const credentials = await ensureSyncVaultCredentials(deviceId, deviceName)

      await registerLocalSyncDevice({
        credentials,
        deviceId,
        deviceName
      })

      const runtime = await ensureSyncReplicationRuntime({
        credentials,
        deviceId,
        onActiveChange(isActive) {
          if (!localSyncState.enabled || localSyncState.isPaused) {
            return
          }

          mutateState({
            status: isActive
              ? 'syncing'
              : deriveStatus({
                  enabled: localSyncState.enabled,
                  isPaused: localSyncState.isPaused,
                  hasError: Boolean(localSyncState.lastError)
                })
          })
        },
        onError(error) {
          if (!runPromise) {
            applyLocalSyncFailure(error)
          }
        }
      })

      await runtime.start()
      runtime.reSync()
      await runtime.awaitInSync()

      if (!localSyncState.enabled || localSyncState.isPaused) {
        refreshStatus()
        return
      }

      mutateState({
        lastSyncSuccessAt: new Date().toISOString(),
        lastErrorCode: null,
        lastError: null,
        nextRetryAt: null,
        retryAttemptCount: 0
      })

      refreshStatus()
    } catch (error) {
      applyLocalSyncFailure(error)
    } finally {
      runPromise = null
    }
  })()

  await runPromise
}

export async function resetLocalSyncOrchestratorStateAfterLocalDataClear(): Promise<void> {
  await ensureLocalSyncOrchestratorStarted()
  clearScheduledRetry()
  await cancelSyncReplicationRuntime()
  await clearLocalSyncVaultCredentials()
  await clearLocalSyncVaultPassphrase()

  mutateState({
    enabled: false,
    isPaused: false,
    status: 'idle',
    vaultId: null,
    transportMode: null,
    deviceId: null,
    lastSyncAttemptAt: null,
    lastSyncSuccessAt: null,
    lastTriggerReason: null,
    lastErrorCode: null,
    lastError: null,
    nextRetryAt: null,
    retryAttemptCount: 0
  })

  await ensureDeviceId()
  refreshStatus()
}

async function hydrateLocalSyncState(): Promise<void> {
  if (hydratePromise) {
    return hydratePromise
  }

  hydratePromise = (async () => {
    const stored = normalizeStoredLocalSyncState(await readClientValue<unknown>(LOCAL_SYNC_STATE_KEY))

    mutateState({
      initialized: true,
      enabled: stored.enabled,
      isPaused: stored.isPaused,
      vaultId: stored.vaultId,
      transportMode: stored.transportMode ?? null,
      lastSyncAttemptAt: stored.lastSyncAttemptAt,
      lastSyncSuccessAt: stored.lastSyncSuccessAt,
      lastTriggerReason: stored.lastTriggerReason,
      lastErrorCode: stored.lastErrorCode,
      lastError: stored.lastError,
      nextRetryAt: stored.nextRetryAt,
      retryAttemptCount: stored.retryAttemptCount,
      status: deriveStatus({
        enabled: stored.enabled,
        isPaused: stored.isPaused,
        hasError: Boolean(stored.lastError)
      }),
      isOnline: typeof window === 'undefined' ? true : window.navigator.onLine
    })
  })().catch((error) => {
    hydratePromise = null
    throw error
  })

  await hydratePromise
}

async function ensureDeviceId() {
  if (localSyncState.deviceId && localSyncState.lastError !== FALLBACK_DEVICE_ID_WARNING) {
    return localSyncState.deviceId
  }

  try {
    const deviceId = await readPhase0LocalDeviceId()
    mutateState({
      deviceId,
      lastError: localSyncState.lastError === FALLBACK_DEVICE_ID_WARNING
        ? null
        : localSyncState.lastError
    })
    refreshStatus()
    return deviceId
  } catch (error) {
    console.error('Failed to read Phase 0 local device ID for sync orchestrator', error)
    const fallbackDeviceId = localSyncState.deviceId ?? createFallbackDeviceId()
    mutateState({
      deviceId: fallbackDeviceId,
      lastError: localSyncState.lastError ?? FALLBACK_DEVICE_ID_WARNING
    })
    refreshStatus()
    return fallbackDeviceId
  }
}

function registerLifecycleListeners() {
  if (listenersRegistered || typeof window === 'undefined') {
    return
  }

  const handleOnline = () => {
    mutateState({ isOnline: true })

    if (localSyncState.enabled && !localSyncState.isPaused) {
      void runLocalSync('online')
      return
    }

    refreshStatus()
  }

  const handleOffline = () => {
    mutateState({ isOnline: false })
    refreshStatus()
  }

  const handleVisibilityChange = () => {
    if (typeof document === 'undefined') {
      return
    }

    if (document.visibilityState !== 'visible') {
      return
    }

    if (localSyncState.enabled && !localSyncState.isPaused) {
      void runLocalSync('visibility')
      return
    }

    refreshStatus()
  }

  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  listenersRegistered = true
}

function refreshStatus() {
  if (localSyncState.status === 'syncing' && localSyncState.enabled && !localSyncState.isPaused) {
    return
  }

  mutateState({
    status: deriveStatus({
      enabled: localSyncState.enabled,
      isPaused: localSyncState.isPaused,
      hasError: Boolean(localSyncState.lastError)
    })
  })
}

function scheduleLocalSyncRetry(delayMs: number) {
  if (typeof window === 'undefined') {
    return
  }

  clearScheduledRetry()
  retryTimer = window.setTimeout(() => {
    retryTimer = null

    if (!localSyncState.enabled || localSyncState.isPaused) {
      mutateState({
        nextRetryAt: null
      })
      return
    }

    void runLocalSync('retry')
  }, delayMs)
}

function clearScheduledRetry() {
  if (retryTimer === null) {
    return
  }

  clearTimeout(retryTimer)
  retryTimer = null
}

function applyLocalSyncFailure(error: unknown) {
  const details = classifyLocalSyncError(error)
  const retryDelayMs = details.retryable ? getLocalSyncRetryDelayMs(localSyncState.retryAttemptCount) : null
  const nextRetryAt = retryDelayMs ? new Date(Date.now() + retryDelayMs).toISOString() : null

  mutateState({
    status: 'error',
    lastErrorCode: details.code,
    lastError: formatLocalSyncErrorMessage(details, retryDelayMs),
    nextRetryAt,
    retryAttemptCount: retryDelayMs ? localSyncState.retryAttemptCount + 1 : 0
  })

  if (retryDelayMs && localSyncState.enabled && !localSyncState.isPaused) {
    scheduleLocalSyncRetry(retryDelayMs)
  }
}

function mutateState(patch: Partial<LocalSyncRuntimeState>) {
  Object.assign(localSyncState, patch, {
    lastStateUpdatedAt: new Date().toISOString()
  })
  void persistLocalSyncState()
}

async function persistLocalSyncState() {
  if (persistPromise) {
    pendingPersist = true
    return persistPromise
  }

  persistPromise = (async () => {
    do {
      pendingPersist = false
      await writeClientValue(LOCAL_SYNC_STATE_KEY, {
        version: 1,
        enabled: localSyncState.enabled,
        isPaused: localSyncState.isPaused,
        vaultId: localSyncState.vaultId,
        transportMode: localSyncState.transportMode,
        lastSyncAttemptAt: localSyncState.lastSyncAttemptAt,
        lastSyncSuccessAt: localSyncState.lastSyncSuccessAt,
        lastTriggerReason: localSyncState.lastTriggerReason,
        lastErrorCode: localSyncState.lastErrorCode,
        lastError: localSyncState.lastError,
        nextRetryAt: localSyncState.nextRetryAt,
        retryAttemptCount: localSyncState.retryAttemptCount
      } satisfies StoredLocalSyncState)
    } while (pendingPersist)
  })().catch((error) => {
    console.error('Failed to persist local sync state', error)
    Object.assign(localSyncState, {
      status: 'error',
      lastError: error instanceof Error ? error.message : 'Could not persist local sync state.',
      lastStateUpdatedAt: new Date().toISOString()
    })
  }).finally(() => {
    persistPromise = null
  })

  return persistPromise
}

function normalizeStoredLocalSyncState(value: unknown): StoredLocalSyncState {
  if (!value || typeof value !== 'object') {
    return {
      version: 1,
      enabled: false,
      isPaused: false,
      vaultId: null,
      transportMode: null,
      lastSyncAttemptAt: null,
      lastSyncSuccessAt: null,
      lastTriggerReason: null,
      lastErrorCode: null,
      lastError: null,
      nextRetryAt: null,
      retryAttemptCount: 0
    }
  }

  const record = value as Partial<StoredLocalSyncState>

  if (record.version !== 1) {
    return {
      version: 1,
      enabled: false,
      isPaused: false,
      vaultId: null,
      transportMode: null,
      lastSyncAttemptAt: null,
      lastSyncSuccessAt: null,
      lastTriggerReason: null,
      lastErrorCode: null,
      lastError: null,
      nextRetryAt: null,
      retryAttemptCount: 0
    }
  }

  return {
    version: 1,
    enabled: record.enabled === true,
    isPaused: record.isPaused === true,
    vaultId: normalizeNullableString(record.vaultId),
    transportMode: isSyncTransportMode(record.transportMode) ? record.transportMode : null,
    lastSyncAttemptAt: normalizeNullableIso(record.lastSyncAttemptAt),
    lastSyncSuccessAt: normalizeNullableIso(record.lastSyncSuccessAt),
    lastTriggerReason: normalizeTriggerReason(record.lastTriggerReason),
    lastErrorCode: isLocalSyncErrorCode(record.lastErrorCode) ? record.lastErrorCode : null,
    lastError: normalizeNullableString(record.lastError),
    nextRetryAt: normalizeNullableIso(record.nextRetryAt),
    retryAttemptCount: normalizeRetryAttemptCount(record.retryAttemptCount)
  }
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function normalizeNullableIso(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
}

function normalizeTriggerReason(value: unknown): LocalSyncTriggerReason | null {
  return value === 'startup' || value === 'manual' || value === 'online' || value === 'visibility' || value === 'retry'
    ? value
    : null
}

function normalizeRetryAttemptCount(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0
  }

  return Math.round(value)
}

function deriveStatus(input: { enabled: boolean, isPaused: boolean, hasError: boolean }): LocalSyncStatus {
  if (input.hasError) {
    return 'error'
  }

  if (!input.enabled) {
    return 'idle'
  }

  if (input.isPaused) {
    return 'paused'
  }

  return 'idle'
}

function getLocalSyncRetryDelayMs(retryAttemptCount: number) {
  const normalizedAttemptCount = Number.isFinite(retryAttemptCount) ? Math.max(0, Math.round(retryAttemptCount)) : 0
  return LOCAL_SYNC_RETRY_BACKOFF_MS[Math.min(normalizedAttemptCount, LOCAL_SYNC_RETRY_BACKOFF_MS.length - 1)] ?? LOCAL_SYNC_RETRY_BACKOFF_MS[0]
}

function createFallbackDeviceId() {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  return `sync-device-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

async function ensureSyncVaultCredentials(deviceId: string, deviceName: string) {
  const credentials = await ensureDevelopmentSyncVault({
    deviceId,
    deviceName
  })

  if (!credentials) {
    throw new Error('No sync vault is configured for this device yet. Set up encrypted sync or connect to an existing encrypted vault first.')
  }

  mutateState({
    vaultId: credentials.vaultId,
    transportMode: credentials.transportMode
  })

  return credentials
}

function getLocalSyncDeviceName() {
  if (typeof window === 'undefined') {
    return 'Browser device'
  }

  const platform = typeof window.navigator.platform === 'string' && window.navigator.platform.trim()
    ? window.navigator.platform.trim()
    : null

  return platform ? `${platform} browser` : 'Browser device'
}
