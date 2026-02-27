import { reactive, readonly } from 'vue'
import { readClientValue, writeClientValue } from '../client-db'
import { readPhase0LocalDeviceId } from '../db/rxdb-phase0'

export type LocalSyncStatus = 'idle' | 'syncing' | 'paused' | 'error'
export type LocalSyncTriggerReason = 'startup' | 'manual' | 'online' | 'visibility'

type StoredLocalSyncState = {
  version: 1
  enabled: boolean
  isPaused: boolean
  vaultId: string | null
  lastSyncAttemptAt: string | null
  lastSyncSuccessAt: string | null
  lastTriggerReason: LocalSyncTriggerReason | null
  lastError: string | null
}

type LocalSyncRuntimeState = {
  initialized: boolean
  started: boolean
  enabled: boolean
  isPaused: boolean
  status: LocalSyncStatus
  vaultId: string | null
  deviceId: string | null
  lastSyncAttemptAt: string | null
  lastSyncSuccessAt: string | null
  lastTriggerReason: LocalSyncTriggerReason | null
  lastError: string | null
  lastStateUpdatedAt: string | null
  isOnline: boolean
}

const LOCAL_SYNC_STATE_KEY = 'sync-local-state-v1'

const defaultState: LocalSyncRuntimeState = {
  initialized: false,
  started: false,
  enabled: false,
  isPaused: false,
  status: 'idle',
  vaultId: null,
  deviceId: null,
  lastSyncAttemptAt: null,
  lastSyncSuccessAt: null,
  lastTriggerReason: null,
  lastError: null,
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
    lastError: null
  })

  if (!enabled) {
    mutateState({
      isPaused: false
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

  mutateState({
    isPaused: true
  })
  refreshStatus()
}

export async function resumeLocalSync(): Promise<void> {
  await ensureLocalSyncOrchestratorStarted()

  if (!localSyncState.enabled) {
    return
  }

  mutateState({
    isPaused: false,
    lastError: null
  })

  void runLocalSync('manual')
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

    mutateState({
      status: 'syncing',
      lastError: null,
      lastSyncAttemptAt: new Date().toISOString(),
      lastTriggerReason: reason
    })

    try {
      // Phase 2 intentionally has no network sync yet. This simulates the
      // orchestration lifecycle and records trigger/attempt metadata.
      await promiseWait(50)

      mutateState({
        lastSyncSuccessAt: new Date().toISOString()
      })

      refreshStatus()
    } catch (error) {
      mutateState({
        status: 'error',
        lastError: error instanceof Error ? error.message : 'Local sync orchestration failed.'
      })
    } finally {
      runPromise = null
    }
  })()

  await runPromise
}

export async function resetLocalSyncOrchestratorStateAfterLocalDataClear(): Promise<void> {
  await ensureLocalSyncOrchestratorStarted()

  mutateState({
    enabled: false,
    isPaused: false,
    status: 'idle',
    vaultId: null,
    deviceId: null,
    lastSyncAttemptAt: null,
    lastSyncSuccessAt: null,
    lastTriggerReason: null,
    lastError: null
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
      lastSyncAttemptAt: stored.lastSyncAttemptAt,
      lastSyncSuccessAt: stored.lastSyncSuccessAt,
      lastTriggerReason: stored.lastTriggerReason,
      lastError: stored.lastError,
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
  if (localSyncState.deviceId) {
    return localSyncState.deviceId
  }

  try {
    const deviceId = await readPhase0LocalDeviceId()
    mutateState({ deviceId })
    return deviceId
  } catch (error) {
    console.error('Failed to read Phase 0 local device ID for sync orchestrator', error)
    const fallbackDeviceId = createFallbackDeviceId()
    mutateState({
      deviceId: fallbackDeviceId,
      lastError: localSyncState.lastError ?? 'Using fallback local sync device ID.'
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
  if (localSyncState.status === 'syncing') {
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
        lastSyncAttemptAt: localSyncState.lastSyncAttemptAt,
        lastSyncSuccessAt: localSyncState.lastSyncSuccessAt,
        lastTriggerReason: localSyncState.lastTriggerReason,
        lastError: localSyncState.lastError
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
      lastSyncAttemptAt: null,
      lastSyncSuccessAt: null,
      lastTriggerReason: null,
      lastError: null
    }
  }

  const record = value as Partial<StoredLocalSyncState>

  if (record.version !== 1) {
    return {
      version: 1,
      enabled: false,
      isPaused: false,
      vaultId: null,
      lastSyncAttemptAt: null,
      lastSyncSuccessAt: null,
      lastTriggerReason: null,
      lastError: null
    }
  }

  return {
    version: 1,
    enabled: record.enabled === true,
    isPaused: record.isPaused === true,
    vaultId: normalizeNullableString(record.vaultId),
    lastSyncAttemptAt: normalizeNullableIso(record.lastSyncAttemptAt),
    lastSyncSuccessAt: normalizeNullableIso(record.lastSyncSuccessAt),
    lastTriggerReason: normalizeTriggerReason(record.lastTriggerReason),
    lastError: normalizeNullableString(record.lastError)
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
  return value === 'startup' || value === 'manual' || value === 'online' || value === 'visibility'
    ? value
    : null
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

function createFallbackDeviceId() {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  return `sync-device-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function promiseWait(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}
