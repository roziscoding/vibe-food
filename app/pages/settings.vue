<script setup lang="ts">
import { testAiProviderKey } from '../utils/ai-meal-import'
import {
  clearAiIntegration,
  isAiIntegrationUnlocked as getIsAiIntegrationUnlocked,
  isValidAiPin,
  lockAiIntegration,
  readAiIntegrationMetadata,
  replaceAiIntegration,
  setupAiIntegration,
  unlockAiIntegration
} from '../utils/client-ai-integration'
import type { AiIntegrationMetadata } from '../utils/client-ai-integration'
import { clearClientData } from '../utils/client-db'
import {
  createEncryptedSyncVault,
  deleteRemoteSyncVault,
  listLocalSyncDevices,
  readLocalSyncVaultCredentials,
  readLocalSyncVaultPassphrase
} from '../utils/sync/credentials'
import type { LocalSyncVaultCredentials } from '../utils/sync/credentials'
import { readLocalSyncConflictEntries } from '../utils/sync/conflicts'
import type { LocalSyncConflictEntry } from '../utils/sync/conflicts'
import { fetchSyncVaultKeyRecord, unwrapSyncVaultKeyRecord } from '../utils/sync/e2ee'
import {
  connectLocalSyncToExistingVault,
  ensureLocalSyncOrchestratorStarted,
  resetLocalSyncOrchestratorStateAfterLocalDataClear,
  resumeLocalSync,
  runLocalSync,
  setLocalSyncEnabled,
  signOutLocalSyncKeepingLocalData,
  useLocalSyncState
} from '../utils/sync/local-sync'
import type { LocalSyncStatus } from '../utils/sync/local-sync'
import {
  authorizeLocalSyncPairingRequest,
  buildLocalSyncPairingAuthorizeUrl,
  createLocalSyncPairingRequest,
  getLocalSyncPairingAuthorizeQueryKey,
  getLocalSyncPairingStatus,
  normalizeLocalSyncPairingCode
} from '../utils/sync/pairing'
import type { LocalSyncPairingPayload } from '../utils/sync/pairing'
import {
  DEFAULT_AI_PROVIDER,
  DEFAULT_CARBS_GOAL,
  DEFAULT_DAILY_CALORIE_GOAL,
  DEFAULT_FAT_GOAL,
  DEFAULT_PROTEIN_GOAL,
  readAppSettings,
  writeAppSettings
} from '../utils/client-settings'
import type { AiProvider, AppSettings } from '../utils/client-settings'
import type { SyncDeviceRecord, SyncPairingCredentialsPayload } from '#shared/utils/sync/protocol'

type GoalSettings = Pick<AppSettings, 'dailyCalorieGoal' | 'proteinGoal' | 'carbsGoal' | 'fatGoal'>
type SyncRecoveryExportPayload = {
  version: 1
  exportedAt: string
  vaultId: string
  vaultToken: string
  transportMode: LocalSyncVaultCredentials['transportMode']
  createdAt: string
  passphrase: string
}
type QrScannerModule = typeof import('qr-scanner')
type QrScannerConstructor = QrScannerModule['default']
type QrScannerInstance = InstanceType<QrScannerConstructor>

type RecommendationSex = 'female' | 'male'
type RecommendationObjective = 'loss' | 'maintenance' | 'gain' | 'muscle'
type RecommendationActivity = 'sedentary' | 'low-active' | 'active' | 'very-active'

const AI_PROVIDER_OPTIONS = [
  { label: 'OpenAI', value: 'openai' },
  { label: 'Anthropic', value: 'anthropic' }
]

const RECOMMENDATION_SEX_OPTIONS = [
  { label: 'Female', value: 'female' },
  { label: 'Male', value: 'male' }
]

const RECOMMENDATION_ACTIVITY_OPTIONS = [
  { label: 'Sedentary', value: 'sedentary' },
  { label: 'Low active', value: 'low-active' },
  { label: 'Active', value: 'active' },
  { label: 'Very active', value: 'very-active' }
]

const RECOMMENDATION_OBJECTIVE_OPTIONS = [
  { label: 'Weight loss', value: 'loss' },
  { label: 'Maintenance', value: 'maintenance' },
  { label: 'Weight gain', value: 'gain' },
  { label: 'Build muscle', value: 'muscle' }
]

const goalsActionMenuItems = [[{
  label: 'Recommend goals',
  icon: 'i-lucide-wand-sparkles',
  onSelect: () => openRecommendationModal()
}]]

const route = useRoute()
const router = useRouter()
const syncPairingAuthorizeQueryKey = getLocalSyncPairingAuthorizeQueryKey()

const isLoaded = ref(false)
const isSaving = ref(false)
const isSavingAiIntegration = ref(false)
const isTestingAiIntegrationKey = ref(false)
const isClearingData = ref(false)
const isRecommendationModalOpen = ref(false)
const currentSettings = ref<AppSettings>(createDefaultAppSettings())
const aiIntegration = ref<AiIntegrationMetadata | null>(null)
const isAiUnlocked = ref(false)
const formError = ref('')
const saveNotice = ref('')
const aiIntegrationError = ref('')
const aiIntegrationNotice = ref('')
const recommendationError = ref('')
const dangerError = ref('')
const dangerNotice = ref('')
const isAiSetupModalOpen = ref(false)
const aiSetupError = ref('')
const aiSetupProvider = ref<AiProvider>(DEFAULT_AI_PROVIDER)
const aiSetupApiKey = ref('')
const isAiChangeProviderModalOpen = ref(false)
const aiChangeProviderError = ref('')
const aiChangeProviderProvider = ref<AiProvider>(DEFAULT_AI_PROVIDER)
const aiChangeProviderApiKey = ref('')
const isAiUnlockModalOpen = ref(false)
const aiUnlockError = ref('')
const aiUnlockPin = ref('')
const localSync = useLocalSyncState()
const isSyncActionPending = ref(false)
const syncStatusActionError = ref('')
const syncStatusActionNotice = ref('')
const syncVaultCredentials = ref<LocalSyncVaultCredentials | null>(null)
const isSyncBootstrapModalOpen = ref(false)
const isSyncBootstrapPending = ref(false)
const syncBootstrapError = ref('')
const syncBootstrapDeviceName = ref('')
const syncBootstrapPassphrase = ref('')
const syncBootstrapPassphraseConfirm = ref('')
const isSyncDevicesLoading = ref(false)
const syncDevices = ref<SyncDeviceRecord[]>([])
const syncDevicesError = ref('')
const syncConflictEntries = ref<LocalSyncConflictEntry[]>([])
const isSyncConflictsLoading = ref(false)
const syncConflictsError = ref('')
const isSyncDetailsModalOpen = ref(false)
const isSyncRecoveryModalOpen = ref(false)
const syncRecoveryPayload = ref('')
const syncRecoveryError = ref('')
const syncRecoveryNotice = ref('')
const isSyncDeleteCloudModalOpen = ref(false)
const isSyncDeleteCloudPending = ref(false)
const syncDeleteCloudConfirmValue = ref('')
const syncDeleteCloudError = ref('')
const isSyncConnectModalOpen = ref(false)
const isCreatingSyncPairingRequest = ref(false)
const isGeneratingSyncConnectQr = ref(false)
const isSyncConnectQrExpanded = ref(false)
const syncConnectQrDataUrl = ref('')
const syncConnectQrUrl = ref('')
const syncConnectError = ref('')
const syncConnectPassphrase = ref('')
const syncPairingRequest = ref<LocalSyncPairingPayload | null>(null)
const syncPairingStatus = ref<'pending' | 'approved' | 'expired' | null>(null)
const syncPairingApprovedCredentials = ref<LocalSyncVaultCredentials | null>(null)
const isCompletingSyncPairingConnect = ref(false)
const isSyncAuthorizeModalOpen = ref(false)
const syncAuthorizeCode = ref('')
const isAuthorizingSyncPairing = ref(false)
const isHandlingSyncAuthorizeQuery = ref(false)
const syncAuthorizeError = ref('')
const hasSyncAuthorizeCamera = ref(false)
const isCheckingSyncAuthorizeCamera = ref(false)
const isSyncAuthorizeScannerOpen = ref(false)
const isStartingSyncAuthorizeScanner = ref(false)
const syncAuthorizeScannerError = ref('')
const syncAuthorizeScannerVideo = ref<HTMLVideoElement | null>(null)

let syncPairingStatusPollTimer: ReturnType<typeof setTimeout> | null = null
let syncAuthorizeQrScanner: QrScannerInstance | null = null
let syncAuthorizeQrScannerImportPromise: Promise<QrScannerConstructor> | null = null

const form = reactive({
  dailyCalorieGoal: '',
  proteinGoal: '',
  carbsGoal: '',
  fatGoal: ''
})

const recommendationForm = reactive({
  age: '',
  heightCm: '',
  weightKg: '',
  sex: 'female' as RecommendationSex,
  activityLevel: 'low-active' as RecommendationActivity,
  objective: 'maintenance' as RecommendationObjective
})

const hasUnsavedGoalChanges = computed(() => {
  return (
    normalizeGoalSettingInput(form.dailyCalorieGoal) !== currentSettings.value.dailyCalorieGoal
    || normalizeGoalSettingInput(form.proteinGoal) !== currentSettings.value.proteinGoal
    || normalizeGoalSettingInput(form.carbsGoal) !== currentSettings.value.carbsGoal
    || normalizeGoalSettingInput(form.fatGoal) !== currentSettings.value.fatGoal
  )
})

onMounted(async () => {
  try {
    const [settings, metadata, syncCredentials] = await Promise.all([
      readAppSettings(),
      readAiIntegrationMetadata(),
      readLocalSyncVaultCredentials()
    ])
    currentSettings.value = settings
    aiIntegration.value = metadata
    syncVaultCredentials.value = syncCredentials
    isAiUnlocked.value = getIsAiIntegrationUnlocked()
    setGoalFormValues(settings)
    await refreshSyncDiagnostics(syncCredentials)
  } catch (error) {
    console.error('Failed to load settings from IndexedDB', error)
    formError.value = 'Could not load settings. Using default goals for now.'
    setGoalFormDefaults()
    currentSettings.value = createDefaultAppSettings()
    syncVaultCredentials.value = null
    await refreshSyncDiagnostics(null)
  } finally {
    isLoaded.value = true
  }
})

watch(
  () => [localSync.vaultId, localSync.enabled, localSync.transportMode] as const,
  () => {
    void refreshSyncVaultCredentials()
  }
)

watch(
  () => [localSync.lastSyncSuccessAt, localSync.lastError] as const,
  () => {
    void refreshSyncDiagnostics()
    void refreshAiIntegrationState()
  }
)

watch(
  () => typeof route.query[syncPairingAuthorizeQueryKey] === 'string' ? route.query[syncPairingAuthorizeQueryKey] : null,
  (value) => {
    if (!value) {
      return
    }

    void prepareSyncAuthorizeModalFromQuery(value)
  },
  {
    immediate: true
  }
)

watch(isSyncConnectModalOpen, (isOpen) => {
  if (isOpen) {
    return
  }

  clearSyncPairingStatusPolling()
  syncConnectError.value = ''
  syncConnectQrDataUrl.value = ''
  syncConnectQrUrl.value = ''
  syncConnectPassphrase.value = ''
  isSyncConnectQrExpanded.value = false
  syncPairingRequest.value = null
  syncPairingStatus.value = null
  syncPairingApprovedCredentials.value = null
})

watch(isSyncBootstrapModalOpen, (isOpen) => {
  if (isOpen) {
    return
  }

  syncBootstrapError.value = ''
  syncBootstrapDeviceName.value = ''
  syncBootstrapPassphrase.value = ''
  syncBootstrapPassphraseConfirm.value = ''
})

watch(isSyncRecoveryModalOpen, (isOpen) => {
  if (isOpen) {
    return
  }

  syncRecoveryError.value = ''
  syncRecoveryNotice.value = ''
})

watch(isSyncDeleteCloudModalOpen, (isOpen) => {
  if (isOpen) {
    return
  }

  syncDeleteCloudConfirmValue.value = ''
  syncDeleteCloudError.value = ''
})

watch(isSyncAuthorizeModalOpen, (isOpen) => {
  if (isOpen) {
    void refreshSyncAuthorizeCameraAvailability()
    return
  }

  stopSyncAuthorizeScanner()
  syncAuthorizeCode.value = ''
  syncAuthorizeError.value = ''
  syncAuthorizeScannerError.value = ''
})

onBeforeUnmount(() => {
  clearSyncPairingStatusPolling()
  stopSyncAuthorizeScanner()
})

const syncStatusLabel = computed(() => {
  if (!localSync.enabled) {
    return 'Off'
  }

  if (localSync.status === 'error' && localSync.nextRetryAt) {
    return 'Retrying soon'
  }

  switch (localSync.status) {
    case 'syncing':
      return 'Checking now'
    case 'paused':
      return 'Paused'
    case 'error':
      return 'Needs attention'
    default:
      return 'Up to date'
  }
})

const syncStatusColor = computed(() => {
  if (!localSync.enabled) {
    return 'neutral'
  }

  if (localSync.status === 'error' && localSync.nextRetryAt) {
    return 'warning'
  }

  switch (localSync.status) {
    case 'syncing':
      return 'primary'
    case 'error':
      return 'error'
    case 'paused':
      return 'neutral'
    default:
      return 'success'
  }
})

const syncTransportModeLabel = computed(() => {
  switch (syncVaultCredentials.value?.transportMode ?? localSync.transportMode) {
    case 'plaintext-dev':
      return 'Legacy unencrypted'
    case 'e2ee-v1':
      return 'Encrypted (E2EE)'
    default:
      return 'Not configured'
  }
})

const hasStoredSyncVault = computed(() => Boolean(syncVaultCredentials.value))
const showSyncActionMenu = computed(() => hasStoredSyncVault.value)
const hasLegacyEncryptedAiIntegration = computed(() => aiIntegration.value?.storageMode === 'legacy-encrypted')
const aiIntegrationStatusLabel = computed(() => hasLegacyEncryptedAiIntegration.value ? 'Legacy format' : 'Ready')
const aiIntegrationStatusColor = computed(() => hasLegacyEncryptedAiIntegration.value ? 'warning' : 'success')

const canExportSyncRecoveryKey = computed(() => {
  return syncVaultCredentials.value?.transportMode === 'e2ee-v1'
})

const canManageRemoteSyncVault = computed(() => hasStoredSyncVault.value)

const canAuthorizeNewDevice = computed(() => {
  return localSync.enabled
    && syncVaultCredentials.value?.transportMode === 'e2ee-v1'
})

const syncPanelDescription = computed(() => {
  if (!hasStoredSyncVault.value) {
    return 'Set up end-to-end encrypted sync to keep meals, ingredients, settings, and AI integration available across linked devices. Data is encrypted on-device before upload, the server stores only ciphertext, and new devices are approved from one you already trust.'
  }

  return 'Keep meals, ingredients, and settings synced across your devices. The cloud copy stays encrypted.'
})

const syncOverviewTitle = computed(() => {
  if (!hasStoredSyncVault.value) {
    return 'Encrypted sync is not set up on this device yet.'
  }

  if (!localSync.enabled) {
    return 'This device is linked, but sync is currently turned off.'
  }

  if (localSync.isPaused) {
    return 'Sync is paused on this device.'
  }

  if (localSync.status === 'error' && localSync.nextRetryAt) {
    return 'Sync hit a temporary issue and will retry automatically.'
  }

  if (localSync.status === 'error') {
    return 'Sync needs attention on this device.'
  }

  if (localSync.status === 'syncing') {
    return 'Your data is syncing now.'
  }

  return 'Your data is syncing normally on this device.'
})

const syncOverviewDescription = computed(() => {
  if (!hasStoredSyncVault.value) {
    return 'Set up encrypted sync here, or connect this browser to an existing encrypted device. The cloud copy stays encrypted.'
  }

  if (!localSync.enabled) {
    return 'This browser still remembers your encrypted vault. Turn sync back on whenever you want it to start syncing again.'
  }

  if (localSync.isPaused) {
    return 'Local changes stay on this device until you resume. Nothing new is sent to the cloud while sync is paused.'
  }

  if (localSync.status === 'error' && localSync.nextRetryAt) {
    return `A retry is already scheduled for ${formatLocalSyncDateTime(localSync.nextRetryAt)}. Open details if you need the technical reason.`
  }

  if (localSync.status === 'error') {
    return 'Something blocked the last sync attempt. Open details if you need the technical reason.'
  }

  if (localSync.status === 'syncing') {
    return 'This browser is checking for changes in the background right now.'
  }

  return 'Meals, ingredients, and settings sync in the background whenever this device is online.'
})

const syncLastSuccessSummary = computed(() => {
  if (!hasStoredSyncVault.value) {
    return 'Not set up yet'
  }

  if (!localSync.lastSyncSuccessAt) {
    return 'No completed sync yet'
  }

  return formatLocalSyncDateTime(localSync.lastSyncSuccessAt)
})

const syncDeviceSummary = computed(() => {
  if (!canManageRemoteSyncVault.value) {
    return 'Not connected'
  }

  if (isSyncDevicesLoading.value) {
    return 'Loading devices...'
  }

  if (syncDevicesError.value) {
    return 'Unavailable'
  }

  if (!syncDevices.value.length) {
    return 'No linked devices reported yet'
  }

  return syncDevices.value.length === 1 ? '1 linked device' : `${syncDevices.value.length} linked devices`
})

const syncConflictSummary = computed(() => {
  if (isSyncConflictsLoading.value) {
    return 'Loading issues...'
  }

  if (syncConflictsError.value) {
    return 'Unavailable'
  }

  if (!syncConflictEntries.value.length) {
    return 'No recent issues'
  }

  return syncConflictEntries.value.length === 1 ? '1 recent issue logged' : `${syncConflictEntries.value.length} recent issues logged`
})

const syncActionMenuItems = computed(() => {
  const actionItems: Array<Array<Record<string, unknown>>> = []
  const primaryItems: Array<Record<string, unknown>> = []
  const vaultItems: Array<Record<string, unknown>> = [
    {
      label: 'Technical details',
      icon: 'i-lucide-info',
      onSelect: () => openSyncDetailsModal()
    }
  ]

  if (!localSync.enabled) {
    if (hasStoredSyncVault.value) {
      primaryItems.push({
        label: 'Enable sync',
        icon: 'i-lucide-toggle-right',
        disabled: isSyncActionPending.value,
        onSelect: () => {
          void enableLocalSyncOrchestrator()
        }
      })
    } else {
      primaryItems.push(
        {
          label: 'Set up encrypted sync',
          icon: 'i-lucide-lock-keyhole',
          disabled: isSyncBootstrapPending.value || isCreatingSyncPairingRequest.value,
          onSelect: () => openSyncBootstrapModal()
        },
        {
          label: 'Connect to existing device',
          icon: 'i-lucide-link',
          disabled: isSyncBootstrapPending.value || isCreatingSyncPairingRequest.value,
          onSelect: () => openSyncConnectModal()
        }
      )
    }
  } else {
    if (localSync.isPaused) {
      primaryItems.push({
        label: 'Resume sync',
        icon: 'i-lucide-play',
        disabled: isSyncActionPending.value,
        onSelect: () => {
          void resumeLocalSyncOrchestrator()
        }
      })
    } else {
      primaryItems.push({
        label: 'Sync now',
        icon: 'i-lucide-refresh-cw',
        disabled: isSyncActionPending.value,
        onSelect: () => {
          void runManualLocalSyncCheck()
        }
      })
    }

    if (canAuthorizeNewDevice.value) {
      primaryItems.push({
        label: 'Authorize new device',
        icon: 'i-lucide-shield-check',
        onSelect: () => openSyncAuthorizeModal()
      })
    }
  }

  if (canExportSyncRecoveryKey.value) {
    vaultItems.push({
      label: 'Export recovery key',
      icon: 'i-lucide-key-round',
      onSelect: () => openSyncRecoveryModal()
    })
  }

  if (canManageRemoteSyncVault.value) {
    vaultItems.push(
      {
        label: 'Sign out',
        icon: 'i-lucide-log-out',
        onSelect: () => {
          void signOutLocalSync()
        }
      },
      {
        label: 'Delete cloud copy',
        icon: 'i-lucide-cloud-off',
        color: 'error',
        onSelect: () => openSyncDeleteCloudModal()
      }
    )
  }

  if (primaryItems.length) {
    actionItems.push(primaryItems)
  }

  if (vaultItems.length) {
    actionItems.push(vaultItems)
  }

  return actionItems
})

const syncDeleteCloudConfirmationMatches = computed(() => {
  return syncDeleteCloudConfirmValue.value.trim() === (syncVaultCredentials.value?.vaultId ?? '')
})

const syncConnectQrHostWarning = computed(() => {
  return getSyncHostWarning(syncConnectQrUrl.value)
})

const isSyncConnectAwaitingPassphrase = computed(() => {
  return syncPairingStatus.value === 'approved' && Boolean(syncPairingApprovedCredentials.value)
})

const syncConnectModalDescription = computed(() => {
  if (isSyncConnectAwaitingPassphrase.value) {
    return 'Authorization is complete. Enter the same sync passphrase used when this vault was created to finish linking this device.'
  }

  return 'Use this code on a device that is already synced. After approval there, enter the same sync passphrase here to finish linking.'
})

function formatLocalSyncDateTime(value: string | null) {
  if (!value) {
    return 'Never'
  }

  const timestamp = Date.parse(value)

  if (Number.isNaN(timestamp)) {
    return 'Invalid timestamp'
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(timestamp)
}

function getSyncHostWarning(value: string) {
  if (!value) {
    return ''
  }

  try {
    const hostname = new URL(value).hostname

    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return 'This QR uses a localhost URL. Open the app on your computer with a LAN URL before scanning it from another device.'
    }
  } catch {
    return ''
  }

  return ''
}

function statusBadgeLabel(status: LocalSyncStatus) {
  if (status === 'error' && localSync.nextRetryAt) {
    return 'Retry scheduled'
  }

  switch (status) {
    case 'syncing':
      return 'Syncing'
    case 'paused':
      return 'Paused'
    case 'error':
      return 'Error'
    default:
      return 'Idle'
  }
}

function formatLocalSyncErrorCode(value: string | null) {
  switch (value) {
    case 'network':
      return 'Network'
    case 'auth':
      return 'Authentication'
    case 'server':
      return 'Server'
    case 'config':
      return 'Configuration'
    case 'crypto':
      return 'Encryption'
    case 'validation':
      return 'Validation'
    case 'unknown':
      return 'Unknown'
    default:
      return 'None'
  }
}

async function runSyncStatusAction(action: () => Promise<void>, successNotice?: string) {
  if (isSyncActionPending.value) {
    return
  }

  syncStatusActionError.value = ''
  syncStatusActionNotice.value = ''
  isSyncActionPending.value = true

  try {
    await action()

    if (successNotice) {
      syncStatusActionNotice.value = successNotice
    }
  } catch (error) {
    console.error('Local sync action failed', error)
    syncStatusActionError.value = error instanceof Error ? error.message : 'Local sync action failed.'
  } finally {
    await refreshSyncVaultCredentials()
    isSyncActionPending.value = false
  }
}

async function enableLocalSyncOrchestrator() {
  await runSyncStatusAction(
    () => setLocalSyncEnabled(true),
    'Encrypted sync enabled for this device.'
  )
}

function openSyncBootstrapModal() {
  syncStatusActionError.value = ''
  syncStatusActionNotice.value = ''
  syncBootstrapError.value = ''
  syncBootstrapDeviceName.value = getLocalBrowserDeviceName()
  syncBootstrapPassphrase.value = ''
  syncBootstrapPassphraseConfirm.value = ''
  isSyncBootstrapModalOpen.value = true
}

function closeSyncBootstrapModal() {
  if (isSyncBootstrapPending.value) {
    return
  }

  isSyncBootstrapModalOpen.value = false
}

async function resumeLocalSyncOrchestrator() {
  await runSyncStatusAction(
    () => resumeLocalSync(),
    'Sync resumed on this device.'
  )
}

async function runManualLocalSyncCheck() {
  await runSyncStatusAction(
    () => runLocalSync('manual'),
    'Sync check completed.'
  )
}

async function refreshSyncVaultCredentials() {
  try {
    syncVaultCredentials.value = await readLocalSyncVaultCredentials()
    await refreshSyncDiagnostics(syncVaultCredentials.value)
  } catch (error) {
    console.error('Failed to refresh local sync vault credentials', error)
    syncVaultCredentials.value = null
    await refreshSyncDiagnostics(null)
  }
}

async function refreshSyncDiagnostics(credentialsOverride?: LocalSyncVaultCredentials | null) {
  const credentials = credentialsOverride === undefined ? syncVaultCredentials.value : credentialsOverride

  await Promise.all([
    refreshSyncDeviceList(credentials),
    refreshSyncConflictEntries()
  ])
}

async function refreshAiIntegrationState() {
  try {
    aiIntegration.value = await readAiIntegrationMetadata()
  } catch (error) {
    console.error('Failed to read AI integration metadata from IndexedDB', error)
    aiIntegration.value = null
  }

  isAiUnlocked.value = getIsAiIntegrationUnlocked()
}

async function refreshSyncDeviceList(credentialsOverride?: LocalSyncVaultCredentials | null) {
  const credentials = credentialsOverride ?? null
  syncDevicesError.value = ''

  if (!credentials) {
    syncDevices.value = []
    isSyncDevicesLoading.value = false
    return
  }

  isSyncDevicesLoading.value = true

  try {
    syncDevices.value = await listLocalSyncDevices({
      credentials,
      deviceId: localSync.deviceId ?? undefined
    })
  } catch (error) {
    console.error('Failed to load synced devices', error)
    syncDevices.value = []
    syncDevicesError.value = error instanceof Error ? error.message : 'Could not load synced devices.'
  } finally {
    isSyncDevicesLoading.value = false
  }
}

async function refreshSyncConflictEntries() {
  isSyncConflictsLoading.value = true
  syncConflictsError.value = ''

  try {
    syncConflictEntries.value = await readLocalSyncConflictEntries(8)
  } catch (error) {
    console.error('Failed to load local sync conflict entries', error)
    syncConflictEntries.value = []
    syncConflictsError.value = error instanceof Error ? error.message : 'Could not load the local sync conflict log.'
  } finally {
    isSyncConflictsLoading.value = false
  }
}

async function signOutLocalSync() {
  await runSyncStatusAction(
    async () => {
      await signOutLocalSyncKeepingLocalData()
      syncDevices.value = []
    },
    'Signed out of sync on this device. Local meals, ingredients, and settings were kept.'
  )
}

function openSyncDetailsModal() {
  isSyncDetailsModalOpen.value = true
  void refreshSyncDiagnostics(syncVaultCredentials.value)
}

function openSyncDeleteCloudModal() {
  syncDeleteCloudConfirmValue.value = ''
  syncDeleteCloudError.value = ''
  isSyncDeleteCloudModalOpen.value = true
}

function closeSyncDeleteCloudModal() {
  if (isSyncDeleteCloudPending.value) {
    return
  }

  isSyncDeleteCloudModalOpen.value = false
}

async function confirmDeleteCloudSyncCopy() {
  if (isSyncDeleteCloudPending.value) {
    return
  }

  const credentials = syncVaultCredentials.value

  if (!credentials) {
    syncDeleteCloudError.value = 'This device is not connected to a sync vault.'
    return
  }

  if (!syncDeleteCloudConfirmationMatches.value) {
    syncDeleteCloudError.value = 'Type the exact vault ID to confirm cloud deletion.'
    return
  }

  syncDeleteCloudError.value = ''
  syncStatusActionError.value = ''
  syncStatusActionNotice.value = ''
  isSyncDeleteCloudPending.value = true

  try {
    await deleteRemoteSyncVault({
      credentials,
      deviceId: localSync.deviceId ?? undefined
    })
    await signOutLocalSyncKeepingLocalData()
    syncDevices.value = []
    isSyncDeleteCloudModalOpen.value = false
    syncStatusActionNotice.value = 'Deleted the cloud sync copy and disconnected this device. Local data was kept.'
    await refreshSyncVaultCredentials()
  } catch (error) {
    console.error('Failed to delete remote sync vault', error)
    syncDeleteCloudError.value = error instanceof Error ? error.message : 'Could not delete the cloud sync copy.'
  } finally {
    isSyncDeleteCloudPending.value = false
  }
}

async function submitSyncBootstrap() {
  if (isSyncBootstrapPending.value) {
    return
  }

  syncBootstrapError.value = ''
  syncStatusActionError.value = ''
  syncStatusActionNotice.value = ''

  const deviceName = syncBootstrapDeviceName.value.trim() || getLocalBrowserDeviceName()
  const passphrase = syncBootstrapPassphrase.value
  const passphraseConfirm = syncBootstrapPassphraseConfirm.value

  if (passphrase.trim().length < 8) {
    syncBootstrapError.value = 'Choose a sync passphrase with at least 8 characters.'
    return
  }

  if (passphrase !== passphraseConfirm) {
    syncBootstrapError.value = 'Passphrases do not match.'
    return
  }

  isSyncBootstrapPending.value = true
  let createdCredentials: LocalSyncVaultCredentials | null = null

  try {
    await ensureLocalSyncOrchestratorStarted()

    if (!localSync.deviceId) {
      throw new Error('This device ID is not ready yet. Reload the app and try again.')
    }

    createdCredentials = await createEncryptedSyncVault({
      deviceId: localSync.deviceId,
      deviceName,
      passphrase
    })

    syncVaultCredentials.value = createdCredentials
    await setLocalSyncEnabled(true)
    await refreshSyncVaultCredentials()
    await prepareSyncRecoveryExport(createdCredentials, passphrase)

    isSyncBootstrapModalOpen.value = false
    isSyncRecoveryModalOpen.value = true
    syncStatusActionNotice.value = 'Encrypted sync is enabled for this device.'
  } catch (error) {
    console.error('Failed to bootstrap encrypted sync', error)
    const baseMessage = error instanceof Error
      ? error.message
      : 'Could not create the encrypted sync vault.'
    syncBootstrapError.value = createdCredentials
      ? `${baseMessage} The vault was created locally, so you can close this dialog and retry enabling sync.`
      : baseMessage

    if (createdCredentials) {
      await refreshSyncVaultCredentials()
    }
  } finally {
    isSyncBootstrapPending.value = false
  }
}

async function openSyncRecoveryModal() {
  syncStatusActionError.value = ''

  try {
    await prepareSyncRecoveryExport()
    isSyncRecoveryModalOpen.value = true
  } catch (error) {
    console.error('Failed to prepare sync recovery export', error)
    syncStatusActionError.value = error instanceof Error ? error.message : 'Could not prepare the sync recovery export.'
  }
}

function closeSyncRecoveryModal() {
  isSyncRecoveryModalOpen.value = false
}

async function copySyncRecoveryPayload() {
  syncRecoveryError.value = ''
  syncRecoveryNotice.value = ''

  try {
    if (!syncRecoveryPayload.value) {
      await prepareSyncRecoveryExport()
    }

    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
      throw new Error('Clipboard API unavailable')
    }

    await navigator.clipboard.writeText(syncRecoveryPayload.value)
    syncRecoveryNotice.value = 'Recovery key copied.'
  } catch (error) {
    console.error('Failed to copy sync recovery payload', error)
    syncRecoveryError.value = 'Could not copy the recovery key.'
  }
}

async function downloadSyncRecoveryPayload() {
  syncRecoveryError.value = ''
  syncRecoveryNotice.value = ''

  try {
    if (!syncRecoveryPayload.value) {
      await prepareSyncRecoveryExport()
    }

    if (typeof window === 'undefined' || typeof document === 'undefined') {
      throw new Error('Download APIs unavailable')
    }

    const fileName = buildSyncRecoveryFileName(syncVaultCredentials.value)
    const blob = new Blob([syncRecoveryPayload.value], { type: 'application/json' })
    const objectUrl = window.URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = fileName
    anchor.click()
    window.URL.revokeObjectURL(objectUrl)
    syncRecoveryNotice.value = 'Recovery key downloaded.'
  } catch (error) {
    console.error('Failed to download sync recovery payload', error)
    syncRecoveryError.value = 'Could not download the recovery key.'
  }
}

async function prepareSyncRecoveryExport(
  credentialsOverride?: LocalSyncVaultCredentials,
  passphraseOverride?: string
) {
  const credentials = credentialsOverride ?? await readLocalSyncVaultCredentials()

  if (!credentials || credentials.transportMode !== 'e2ee-v1') {
    throw new Error('This device does not have an encrypted sync vault to export yet.')
  }

  const passphrase = passphraseOverride ?? await readLocalSyncVaultPassphrase(credentials.vaultId)

  if (!passphrase) {
    throw new Error('This device does not have the local sync passphrase needed to export a recovery key.')
  }

  syncRecoveryPayload.value = JSON.stringify(buildSyncRecoveryPayload(credentials, passphrase), null, 2)
  syncRecoveryError.value = ''
  syncRecoveryNotice.value = ''
}

function buildSyncRecoveryPayload(
  credentials: LocalSyncVaultCredentials,
  passphrase: string
): SyncRecoveryExportPayload {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    vaultId: credentials.vaultId,
    vaultToken: credentials.vaultToken,
    transportMode: credentials.transportMode,
    createdAt: credentials.createdAt,
    passphrase
  }
}

function buildSyncRecoveryFileName(credentials: LocalSyncVaultCredentials | null) {
  const suffix = credentials?.vaultId ? credentials.vaultId.slice(0, 8) : 'vault'
  return `vibe-food-sync-recovery-${suffix}.json`
}

async function openSyncConnectModal() {
  syncConnectError.value = ''
  syncConnectQrDataUrl.value = ''
  syncConnectQrUrl.value = ''
  syncConnectPassphrase.value = ''
  isSyncConnectQrExpanded.value = false
  syncPairingRequest.value = null
  syncPairingStatus.value = null
  syncPairingApprovedCredentials.value = null
  clearSyncPairingStatusPolling()

  isCreatingSyncPairingRequest.value = true

  try {
    await ensureLocalSyncOrchestratorStarted()

    const requesterDeviceId = localSync.deviceId

    if (!requesterDeviceId) {
      throw new Error('This device ID is not ready yet. Reload the app and try again.')
    }

    const pairingPayload = await createLocalSyncPairingRequest({
      requesterDeviceId,
      requesterDeviceName: getLocalBrowserDeviceName()
    })

    syncPairingRequest.value = pairingPayload
    syncPairingStatus.value = 'pending'
    isSyncConnectModalOpen.value = true
    scheduleSyncPairingStatusPoll()
  } catch (error) {
    console.error('Failed to create sync pairing request', error)
    syncConnectError.value = error instanceof Error ? error.message : 'Could not create the sync pairing request.'
  } finally {
    isCreatingSyncPairingRequest.value = false
  }
}

function getLocalBrowserDeviceName() {
  if (typeof window === 'undefined') {
    return 'Browser device'
  }

  const platform = typeof window.navigator.platform === 'string' && window.navigator.platform.trim()
    ? window.navigator.platform.trim()
    : null

  return platform ? `${platform} browser` : 'Browser device'
}

function formatSyncPairingCode(value: string | null | undefined) {
  if (!value) {
    return '------'
  }

  return value
}

function extractSyncAuthorizeCodeFromScanResult(value: string) {
  const directCode = normalizeLocalSyncPairingCode(value)

  if (directCode) {
    return directCode
  }

  try {
    const baseUrl = typeof window === 'undefined' ? 'https://example.invalid' : window.location.origin
    const parsedUrl = new URL(value, baseUrl)
    return normalizeLocalSyncPairingCode(parsedUrl.searchParams.get(syncPairingAuthorizeQueryKey))
  } catch {
    return null
  }
}

async function loadSyncAuthorizeQrScanner() {
  if (!syncAuthorizeQrScannerImportPromise) {
    syncAuthorizeQrScannerImportPromise = import('qr-scanner').then(module => module.default)
  }

  return syncAuthorizeQrScannerImportPromise
}

async function refreshSyncAuthorizeCameraAvailability() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    hasSyncAuthorizeCamera.value = false
    return
  }

  if (!window.isSecureContext || !navigator.mediaDevices) {
    hasSyncAuthorizeCamera.value = false
    return
  }

  isCheckingSyncAuthorizeCamera.value = true

  try {
    const QrScanner = await loadSyncAuthorizeQrScanner()
    hasSyncAuthorizeCamera.value = await QrScanner.hasCamera()
  } catch (error) {
    console.error('Failed to detect QR scanner camera availability', error)
    hasSyncAuthorizeCamera.value = false
  } finally {
    isCheckingSyncAuthorizeCamera.value = false
  }
}

function stopSyncAuthorizeScanner() {
  if (syncAuthorizeQrScanner) {
    try {
      syncAuthorizeQrScanner.stop()
      syncAuthorizeQrScanner.destroy()
    } catch (error) {
      console.error('Failed to stop QR scanner cleanly', error)
    } finally {
      syncAuthorizeQrScanner = null
    }
  }

  isSyncAuthorizeScannerOpen.value = false
}

async function handleSyncAuthorizeScanResult(value: string) {
  const pairingCode = extractSyncAuthorizeCodeFromScanResult(value)

  if (!pairingCode) {
    syncAuthorizeScannerError.value = 'The scanned QR code does not contain a valid sync pairing code.'
    return
  }

  syncAuthorizeCode.value = pairingCode
  syncAuthorizeError.value = ''
  syncAuthorizeScannerError.value = ''
  stopSyncAuthorizeScanner()
}

async function openSyncAuthorizeScanner() {
  if (typeof window === 'undefined') {
    return
  }

  syncAuthorizeScannerError.value = ''

  if (!hasSyncAuthorizeCamera.value) {
    await refreshSyncAuthorizeCameraAvailability()
  }

  if (!hasSyncAuthorizeCamera.value) {
    syncAuthorizeScannerError.value = 'No camera is available for in-app QR scanning on this device.'
    return
  }

  isStartingSyncAuthorizeScanner.value = true
  isSyncAuthorizeScannerOpen.value = true

  try {
    await nextTick()

    const videoElement = syncAuthorizeScannerVideo.value

    if (!videoElement) {
      throw new Error('The QR scanner preview could not be initialized.')
    }

    const QrScanner = await loadSyncAuthorizeQrScanner()

    syncAuthorizeQrScanner = new QrScanner(
      videoElement,
      (result) => {
        void handleSyncAuthorizeScanResult(result.data)
      },
      {
        preferredCamera: 'environment',
        maxScansPerSecond: 12,
        returnDetailedScanResult: true
      }
    )

    await syncAuthorizeQrScanner.start()
  } catch (error) {
    stopSyncAuthorizeScanner()
    syncAuthorizeScannerError.value = error instanceof Error ? error.message : 'Could not start the camera QR scanner.'
  } finally {
    isStartingSyncAuthorizeScanner.value = false
  }
}

async function toggleSyncAuthorizeScanner() {
  if (isSyncAuthorizeScannerOpen.value) {
    stopSyncAuthorizeScanner()
    return
  }

  await openSyncAuthorizeScanner()
}

async function toggleSyncConnectQr() {
  if (isSyncConnectQrExpanded.value) {
    isSyncConnectQrExpanded.value = false
    return
  }

  if (!syncPairingRequest.value) {
    return
  }

  if (typeof window === 'undefined') {
    syncConnectError.value = 'QR preview is only available in the browser.'
    return
  }

  isGeneratingSyncConnectQr.value = true

  try {
    const authorizeUrl = buildLocalSyncPairingAuthorizeUrl(syncPairingRequest.value.pairingCode, window.location.href)
    const [{ default: QRCode }] = await Promise.all([
      import('qrcode')
    ])

    syncConnectQrUrl.value = authorizeUrl
    syncConnectQrDataUrl.value = await QRCode.toDataURL(authorizeUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320
    })
    isSyncConnectQrExpanded.value = true
  } catch (error) {
    console.error('Failed to generate sync pairing QR code', error)
    syncConnectError.value = error instanceof Error ? error.message : 'Could not generate the sync pairing QR code.'
  } finally {
    isGeneratingSyncConnectQr.value = false
  }
}

function clearSyncPairingStatusPolling() {
  if (syncPairingStatusPollTimer === null) {
    return
  }

  clearTimeout(syncPairingStatusPollTimer)
  syncPairingStatusPollTimer = null
}

function scheduleSyncPairingStatusPoll(delayMs = 1_500) {
  clearSyncPairingStatusPolling()

  if (!syncPairingRequest.value || !isSyncConnectModalOpen.value) {
    return
  }

  syncPairingStatusPollTimer = setTimeout(() => {
    void pollSyncPairingStatus()
  }, delayMs)
}

async function pollSyncPairingStatus() {
  const pairingPayload = syncPairingRequest.value

  if (!pairingPayload) {
    return
  }

  try {
    const status = await getLocalSyncPairingStatus(pairingPayload)
    syncPairingStatus.value = status.status

    if (status.status === 'pending') {
      scheduleSyncPairingStatusPoll()
      return
    }

    if (status.status === 'expired') {
      clearSyncPairingStatusPolling()
      syncConnectError.value = 'This pairing code expired. Generate a new code and enter it on the already synced device.'
      return
    }

    if (!status.credentials) {
      throw new Error('Pairing was approved, but no sync credentials were returned.')
    }

    clearSyncPairingStatusPolling()
    syncPairingApprovedCredentials.value = toLocalSyncVaultCredentials(status.credentials)
    syncConnectError.value = syncConnectPassphrase.value.trim()
      ? ''
      : 'Authorization complete. Enter the sync passphrase to finish linking this device.'
  } catch (error) {
    console.error('Failed to poll sync pairing status', error)
    clearSyncPairingStatusPolling()
    syncConnectError.value = error instanceof Error ? error.message : 'Could not check the sync pairing status.'
  }
}

async function completeSyncConnectPairing() {
  if (isCompletingSyncPairingConnect.value) {
    return
  }

  const credentials = syncPairingApprovedCredentials.value

  if (!credentials) {
    syncConnectError.value = 'Wait for the existing synced device to approve this code first.'
    return
  }

  const passphrase = syncConnectPassphrase.value

  if (passphrase.trim().length < 8) {
    syncConnectError.value = 'Enter the sync passphrase for this encrypted vault.'
    return
  }

  isCompletingSyncPairingConnect.value = true
  syncConnectError.value = ''
  syncStatusActionError.value = ''
  syncStatusActionNotice.value = ''

  try {
    await ensureLocalSyncOrchestratorStarted()

    const deviceId = localSync.deviceId

    if (!deviceId) {
      throw new Error('This device ID is not ready yet. Reload the app and try again.')
    }

    const keyRecord = await fetchSyncVaultKeyRecord(credentials, deviceId)
    await unwrapSyncVaultKeyRecord(keyRecord, passphrase)

    await connectLocalSyncToExistingVault({
      ...credentials,
      passphrase
    })
    await refreshSyncVaultCredentials()
    isSyncConnectModalOpen.value = false
    syncStatusActionNotice.value = 'This device is now linked to the encrypted sync vault.'
  } catch (error) {
    console.error('Failed to finish encrypted sync linking', error)
    syncConnectError.value = error instanceof Error ? error.message : 'Could not finish linking this encrypted sync vault.'
  } finally {
    isCompletingSyncPairingConnect.value = false
  }
}

function closeSyncConnectModal() {
  isSyncConnectModalOpen.value = false
  syncConnectError.value = ''
}

function openSyncAuthorizeModal() {
  syncAuthorizeCode.value = ''
  syncAuthorizeError.value = ''
  syncAuthorizeScannerError.value = ''
  isSyncAuthorizeModalOpen.value = true
}

function closeSyncAuthorizeModal() {
  stopSyncAuthorizeScanner()
  isSyncAuthorizeModalOpen.value = false
  syncAuthorizeCode.value = ''
  syncAuthorizeError.value = ''
  syncAuthorizeScannerError.value = ''
}

async function prepareSyncAuthorizeModalFromQuery(value: string) {
  if (isHandlingSyncAuthorizeQuery.value) {
    return
  }

  isHandlingSyncAuthorizeQuery.value = true

  try {
    await clearSyncAuthorizeQueryFromRoute()

    const pairingCode = normalizeLocalSyncPairingCode(value)

    if (!pairingCode) {
      syncStatusActionError.value = 'The scanned pairing QR code was invalid.'
      return
    }

    const currentCredentials = await readLocalSyncVaultCredentials()

    if (!currentCredentials) {
      syncStatusActionError.value = 'This device must already be synced before it can authorize another device.'
      return
    }

    if (currentCredentials.transportMode !== 'e2ee-v1') {
      syncStatusActionError.value = 'Only encrypted sync vaults can authorize device linking.'
      return
    }

    syncVaultCredentials.value = currentCredentials
    syncAuthorizeCode.value = pairingCode
    syncAuthorizeError.value = ''
    isSyncAuthorizeModalOpen.value = true
  } finally {
    isHandlingSyncAuthorizeQuery.value = false
  }
}

async function clearSyncAuthorizeQueryFromRoute() {
  const { [syncPairingAuthorizeQueryKey]: _removedSyncAuthorizeQuery, ...nextQuery } = route.query
  await router.replace({ query: nextQuery })
}

async function authorizeSyncPairingCode() {
  isAuthorizingSyncPairing.value = true
  syncAuthorizeError.value = ''
  syncStatusActionError.value = ''
  syncStatusActionNotice.value = ''

  try {
    const pairingCode = syncAuthorizeCode.value.trim()

    if (!/^[0-9A-Za-z]{6}$/.test(pairingCode)) {
      throw new Error('Enter the exact 6-character pairing code. Codes are case-sensitive.')
    }

    const currentCredentials = await readLocalSyncVaultCredentials()

    if (!currentCredentials) {
      throw new Error('Enable encrypted sync on this device first so it can authorize another device.')
    }

    if (currentCredentials.transportMode !== 'e2ee-v1') {
      throw new Error('Only encrypted sync vaults can authorize another device.')
    }

    await ensureLocalSyncOrchestratorStarted()

    const approverDeviceId = localSync.deviceId

    if (!approverDeviceId) {
      throw new Error('This device ID is not ready yet. Reload the app and try again.')
    }

    const result = await authorizeLocalSyncPairingRequest({
      pairingCode,
      credentials: currentCredentials,
      deviceId: approverDeviceId
    })

    if (result.status === 'expired') {
      throw new Error('This device approval request expired before it could be approved.')
    }

    if (result.status !== 'approved' || !result.credentials) {
      throw new Error('Could not approve this device request.')
    }

    syncVaultCredentials.value = currentCredentials
    syncStatusActionNotice.value = `Authorized ${result.requesterDeviceName} to join this encrypted sync vault.`
    closeSyncAuthorizeModal()
  } catch (error) {
    console.error('Failed to authorize sync pairing code', error)
    syncAuthorizeError.value = error instanceof Error ? error.message : 'Could not authorize this device.'
  } finally {
    isAuthorizingSyncPairing.value = false
  }
}

function toLocalSyncVaultCredentials(credentials: SyncPairingCredentialsPayload): LocalSyncVaultCredentials {
  if (credentials.transportMode !== 'e2ee-v1') {
    throw new Error('This pairing response did not contain an encrypted sync vault.')
  }

  return {
    version: 1,
    vaultId: credentials.vaultId,
    vaultToken: credentials.vaultToken,
    transportMode: credentials.transportMode,
    createdAt: credentials.createdAt
  }
}

async function saveSettings() {
  formError.value = ''
  saveNotice.value = ''
  aiIntegrationNotice.value = ''

  const parsedGoal = Number(form.dailyCalorieGoal)
  const parsedProteinGoal = Number(form.proteinGoal)
  const parsedCarbsGoal = Number(form.carbsGoal)
  const parsedFatGoal = Number(form.fatGoal)

  if (!Number.isFinite(parsedGoal) || parsedGoal <= 0) {
    formError.value = 'Calorie goal must be greater than 0.'
    return
  }

  if (![parsedProteinGoal, parsedCarbsGoal, parsedFatGoal].every(value => Number.isFinite(value) && value > 0)) {
    formError.value = 'Macro goals must be greater than 0.'
    return
  }

  isSaving.value = true

  try {
    const dailyCalorieGoal = Math.round(parsedGoal)
    const proteinGoal = Math.round(parsedProteinGoal)
    const carbsGoal = Math.round(parsedCarbsGoal)
    const fatGoal = Math.round(parsedFatGoal)
    const nextSettings: AppSettings = {
      dailyCalorieGoal,
      proteinGoal,
      carbsGoal,
      fatGoal
    }

    await writeAppSettings(nextSettings)
    currentSettings.value = nextSettings
    setGoalFormValues({
      dailyCalorieGoal,
      proteinGoal,
      carbsGoal,
      fatGoal
    })
    saveNotice.value = 'Saved. The Meals page gauges will use these goals.'
    dangerError.value = ''
    dangerNotice.value = ''
  } catch (error) {
    console.error('Failed to save settings to IndexedDB', error)
    formError.value = 'Could not save settings. Try again.'
  } finally {
    isSaving.value = false
  }
}

function providerLabel(provider: AiProvider) {
  return provider === 'openai' ? 'OpenAI' : 'Anthropic'
}

function openAiSetupModal() {
  resetAiSetupModal()
  isAiSetupModalOpen.value = true
}

function closeAiSetupModal() {
  isAiSetupModalOpen.value = false
  resetAiSetupModal()
}

function resetAiSetupModal() {
  aiSetupError.value = ''
  aiSetupProvider.value = DEFAULT_AI_PROVIDER
  aiSetupApiKey.value = ''
}

async function saveAiIntegrationSetup() {
  aiSetupError.value = ''
  aiIntegrationError.value = ''
  aiIntegrationNotice.value = ''

  const apiKey = aiSetupApiKey.value.trim()

  if (!apiKey) {
    aiSetupError.value = `Enter an API key for ${providerLabel(aiSetupProvider.value)}.`
    return
  }

  isTestingAiIntegrationKey.value = true
  isSavingAiIntegration.value = true

  try {
    await testAiProviderKey({
      provider: aiSetupProvider.value,
      apiKey
    })

    aiIntegration.value = await setupAiIntegration({
      provider: aiSetupProvider.value,
      apiKey
    })
    isAiUnlocked.value = true
    aiIntegrationNotice.value = 'AI integration saved.'
    dangerError.value = ''
    dangerNotice.value = ''
    closeAiSetupModal()
  } catch (error) {
    console.error('Failed to set up AI integration', error)
    aiSetupError.value = error instanceof Error ? error.message : 'Could not set up AI integration.'
  } finally {
    isTestingAiIntegrationKey.value = false
    isSavingAiIntegration.value = false
  }
}

function openAiUnlockModal() {
  aiUnlockError.value = ''
  aiUnlockPin.value = ''
  isAiUnlockModalOpen.value = true
}

function closeAiUnlockModal() {
  aiUnlockError.value = ''
  aiUnlockPin.value = ''
  isAiUnlockModalOpen.value = false
}

async function submitAiUnlock() {
  aiUnlockError.value = ''
  aiIntegrationError.value = ''
  aiIntegrationNotice.value = ''

  if (!isValidAiPin(aiUnlockPin.value)) {
    aiUnlockError.value = 'Legacy encryption password must be exactly 4 digits.'
    return
  }

  isSavingAiIntegration.value = true

  try {
    aiIntegration.value = await unlockAiIntegration(aiUnlockPin.value)
    isAiUnlocked.value = true
    aiIntegrationNotice.value = 'Legacy AI integration upgraded.'
    closeAiUnlockModal()
  } catch (error) {
    aiUnlockError.value = error instanceof Error ? error.message : 'Could not unlock AI integration.'
  } finally {
    isSavingAiIntegration.value = false
  }
}

async function clearAiIntegrationFromDevice() {
  aiIntegrationError.value = ''
  aiIntegrationNotice.value = ''

  if (!aiIntegration.value) {
    return
  }

  if (typeof window !== 'undefined') {
    const confirmed = window.confirm(
      'This will remove the stored AI integration key from this browser and any linked devices that sync it. Continue?'
    )

    if (!confirmed) {
      return
    }
  }

  isSavingAiIntegration.value = true

  try {
    await clearAiIntegration()
    aiIntegration.value = null
    isAiUnlocked.value = false
    aiIntegrationNotice.value = 'AI integration removed.'
  } catch (error) {
    console.error('Failed to clear AI integration', error)
    aiIntegrationError.value = 'Could not clear AI integration. Try again.'
  } finally {
    isSavingAiIntegration.value = false
  }
}

function openAiChangeProviderModal() {
  if (!aiIntegration.value) {
    return
  }

  aiChangeProviderError.value = ''
  aiChangeProviderProvider.value = aiIntegration.value.provider
  aiChangeProviderApiKey.value = ''
  isAiChangeProviderModalOpen.value = true
}

function closeAiChangeProviderModal() {
  aiChangeProviderError.value = ''
  aiChangeProviderProvider.value = aiIntegration.value?.provider ?? DEFAULT_AI_PROVIDER
  aiChangeProviderApiKey.value = ''
  isAiChangeProviderModalOpen.value = false
}

async function submitAiChangeProvider() {
  aiChangeProviderError.value = ''
  aiIntegrationError.value = ''
  aiIntegrationNotice.value = ''

  const apiKey = aiChangeProviderApiKey.value.trim()

  if (!apiKey) {
    aiChangeProviderError.value = `Enter an API key for ${providerLabel(aiChangeProviderProvider.value)}.`
    return
  }

  isTestingAiIntegrationKey.value = true
  isSavingAiIntegration.value = true

  try {
    await testAiProviderKey({
      provider: aiChangeProviderProvider.value,
      apiKey
    })

    aiIntegration.value = await replaceAiIntegration({
      provider: aiChangeProviderProvider.value,
      apiKey
    })
    isAiUnlocked.value = true
    aiIntegrationNotice.value = 'Provider/key updated.'
    closeAiChangeProviderModal()
  } catch (error) {
    console.error('Failed to change AI provider/key', error)
    aiChangeProviderError.value = error instanceof Error ? error.message : 'Could not update provider/key.'
  } finally {
    isTestingAiIntegrationKey.value = false
    isSavingAiIntegration.value = false
  }
}

function openRecommendationModal() {
  recommendationError.value = ''
  isRecommendationModalOpen.value = true
}

function applyRecommendedGoals() {
  recommendationError.value = ''

  const age = Number(recommendationForm.age)
  const heightCm = Number(recommendationForm.heightCm)
  const weightKg = Number(recommendationForm.weightKg)

  if (!Number.isFinite(age) || age < 13 || age > 120) {
    recommendationError.value = 'Enter a valid age (13-120).'
    return
  }

  if (!Number.isFinite(heightCm) || heightCm < 100 || heightCm > 250) {
    recommendationError.value = 'Enter a valid height in cm.'
    return
  }

  if (!Number.isFinite(weightKg) || weightKg < 25 || weightKg > 400) {
    recommendationError.value = 'Enter a valid weight in kg.'
    return
  }

  const recommended = calculateRecommendedGoals({
    age,
    heightCm,
    weightKg,
    sex: recommendationForm.sex,
    activityLevel: recommendationForm.activityLevel,
    objective: recommendationForm.objective
  })

  setGoalFormValues(recommended)

  formError.value = ''
  saveNotice.value = 'Recommendations applied. Review values, then save settings.'
  dangerError.value = ''
  dangerNotice.value = ''
  isRecommendationModalOpen.value = false
}

function resetRecommendationInputs() {
  recommendationForm.age = ''
  recommendationForm.heightCm = ''
  recommendationForm.weightKg = ''
  recommendationForm.sex = 'female'
  recommendationForm.activityLevel = 'low-active'
  recommendationForm.objective = 'maintenance'
  recommendationError.value = ''
}

async function clearAllLocalData() {
  dangerError.value = ''
  dangerNotice.value = ''

  if (typeof window !== 'undefined') {
    const confirmed = window.confirm(
      'This will permanently delete all meals, ingredients, and settings stored in this browser. This cannot be undone.'
    )

    if (!confirmed) {
      return
    }
  }

  isClearingData.value = true

  try {
    await clearClientData()
    await resetLocalSyncOrchestratorStateAfterLocalDataClear()
    lockAiIntegration()
    setGoalFormDefaults()
    currentSettings.value = createDefaultAppSettings()
    aiIntegration.value = null
    isAiUnlocked.value = false
    resetRecommendationInputs()
    recommendationError.value = ''
    formError.value = ''
    saveNotice.value = ''
    aiIntegrationError.value = ''
    aiIntegrationNotice.value = ''
    syncStatusActionError.value = ''
    syncStatusActionNotice.value = ''
    isRecommendationModalOpen.value = false
    isAiSetupModalOpen.value = false
    isAiChangeProviderModalOpen.value = false
    isAiUnlockModalOpen.value = false
    dangerNotice.value = 'All local data was cleared from this browser.'
  } catch (error) {
    console.error('Failed to clear local IndexedDB data', error)
    dangerError.value = 'Could not clear local data. Try again.'
  } finally {
    isClearingData.value = false
  }
}

function setGoalFormDefaults() {
  setGoalFormValues({
    dailyCalorieGoal: DEFAULT_DAILY_CALORIE_GOAL,
    proteinGoal: DEFAULT_PROTEIN_GOAL,
    carbsGoal: DEFAULT_CARBS_GOAL,
    fatGoal: DEFAULT_FAT_GOAL
  })
}

function setGoalFormValues(settings: GoalSettings) {
  form.dailyCalorieGoal = String(settings.dailyCalorieGoal)
  form.proteinGoal = String(settings.proteinGoal)
  form.carbsGoal = String(settings.carbsGoal)
  form.fatGoal = String(settings.fatGoal)
}

function createDefaultAppSettings(): AppSettings {
  return {
    dailyCalorieGoal: DEFAULT_DAILY_CALORIE_GOAL,
    proteinGoal: DEFAULT_PROTEIN_GOAL,
    carbsGoal: DEFAULT_CARBS_GOAL,
    fatGoal: DEFAULT_FAT_GOAL
  }
}

function normalizeGoalSettingInput(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value) : null
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  if (!trimmed) {
    return null
  }

  const parsed = Number(trimmed)

  if (!Number.isFinite(parsed)) {
    return trimmed
  }

  return Math.round(parsed)
}

function calculateRecommendedGoals(input: {
  age: number
  heightCm: number
  weightKg: number
  sex: RecommendationSex
  activityLevel: RecommendationActivity
  objective: RecommendationObjective
}): GoalSettings {
  const bmr = input.sex === 'male'
    ? (9.99 * input.weightKg) + (6.25 * input.heightCm) - (4.92 * input.age) + 5
    : (9.99 * input.weightKg) + (6.25 * input.heightCm) - (4.92 * input.age) - 161

  const activityFactor = getActivityFactor(input.sex, input.activityLevel)
  const maintenanceCalories = bmr * activityFactor

  let calorieAdjustment = 0
  switch (input.objective) {
    case 'loss':
      calorieAdjustment = -500
      break
    case 'gain':
      calorieAdjustment = 300
      break
    case 'muscle':
      calorieAdjustment = 250
      break
    case 'maintenance':
    default:
      calorieAdjustment = 0
      break
  }

  const dailyCalorieGoal = Math.max(1200, Math.round(maintenanceCalories + calorieAdjustment))

  let proteinGoal: number
  let carbsGoal: number
  let fatGoal: number

  if (input.objective === 'loss') {
    ({ proteinGoal, carbsGoal, fatGoal } = macrosFromPercentSplit(dailyCalorieGoal, {
      protein: 0.30,
      carbs: 0.45,
      fat: 0.25
    }))
  } else if (input.objective === 'gain') {
    ({ proteinGoal, carbsGoal, fatGoal } = macrosFromPercentSplit(dailyCalorieGoal, {
      protein: 0.20,
      carbs: 0.55,
      fat: 0.25
    }))
  } else if (input.objective === 'muscle') {
    const fatGoalRaw = (dailyCalorieGoal * 0.25) / 9
    const baseProteinGoal = (dailyCalorieGoal * 0.25) / 4
    const proteinFloor = input.weightKg * 1.6
    const proteinGoalRaw = Math.max(baseProteinGoal, proteinFloor)
    const carbsCalories = Math.max(0, dailyCalorieGoal - (proteinGoalRaw * 4) - (fatGoalRaw * 9))

    proteinGoal = Math.round(proteinGoalRaw)
    fatGoal = Math.round(fatGoalRaw)
    carbsGoal = Math.round(carbsCalories / 4)
  } else {
    ({ proteinGoal, carbsGoal, fatGoal } = macrosFromPercentSplit(dailyCalorieGoal, {
      protein: 0.20,
      carbs: 0.50,
      fat: 0.30
    }))
  }

  return {
    dailyCalorieGoal,
    proteinGoal: Math.max(1, proteinGoal),
    carbsGoal: Math.max(1, carbsGoal),
    fatGoal: Math.max(1, fatGoal)
  }
}

function macrosFromPercentSplit(calories: number, split: { protein: number, carbs: number, fat: number }) {
  return {
    proteinGoal: Math.round((calories * split.protein) / 4),
    carbsGoal: Math.round((calories * split.carbs) / 4),
    fatGoal: Math.round((calories * split.fat) / 9)
  }
}

function getActivityFactor(sex: RecommendationSex, activityLevel: RecommendationActivity) {
  const factors = sex === 'male'
    ? {
        'sedentary': 1.00,
        'low-active': 1.11,
        'active': 1.25,
        'very-active': 1.48
      }
    : {
        'sedentary': 1.00,
        'low-active': 1.12,
        'active': 1.27,
        'very-active': 1.45
      }

  return factors[activityLevel]
}
</script>

<template>
  <div class="flex w-full max-w-4xl flex-col gap-6">
    <header class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-highlighted sm:text-3xl">
          Settings
        </h1>
        <p class="text-sm text-muted">
          Configure this browser and the settings that sync across your linked devices.
        </p>
      </div>

      <UBadge
        color="neutral"
        variant="soft"
        class="w-fit"
      >
        IndexedDB
      </UBadge>
    </header>

    <UCard>
      <div class="space-y-4">
        <div class="space-y-2">
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-2">
              <h2 class="text-lg font-semibold text-highlighted">
                Goals
              </h2>
              <UTooltip text="All settings in this panel are synced to linked devices.">
                <span class="inline-flex">
                  <UIcon
                    name="i-lucide-cloud-check"
                    class="size-4 text-primary"
                    aria-hidden="true"
                  />
                </span>
              </UTooltip>
            </div>

            <UDropdownMenu
              v-slot="{ open }"
              :items="goalsActionMenuItems"
              :content="{ align: 'end' }"
              :ui="{ content: 'min-w-64' }"
            >
              <UButton
                type="button"
                color="neutral"
                variant="soft"
                icon="i-lucide-ellipsis"
                aria-label="Open goals actions"
                :class="[open ? 'bg-elevated' : undefined]"
              />
            </UDropdownMenu>
          </div>
          <p class="text-sm text-muted">
            These goals are used on the Meals page for the calorie and macro gauges.
          </p>
        </div>

        <div
          v-if="!isLoaded"
          class="rounded-lg border border-dashed border-default px-4 py-8 text-center text-sm text-muted"
        >
          Loading settings...
        </div>

        <form
          v-else
          class="space-y-4"
          @submit.prevent="saveSettings"
        >
          <div class="max-w-sm space-y-2">
            <div class="space-y-2">
              <label
                for="daily-calorie-goal"
                class="block text-sm font-medium text-highlighted"
              >
                Goal (kcal)
              </label>
              <UInput
                id="daily-calorie-goal"
                v-model="form.dailyCalorieGoal"
                type="number"
                min="1"
                step="1"
                inputmode="numeric"
                placeholder="2000"
                size="lg"
              />
            </div>
          </div>

          <div class="grid gap-4 md:grid-cols-3">
            <div class="space-y-2">
              <label
                for="protein-goal"
                class="block text-sm font-medium text-highlighted"
              >
                Protein goal (g)
              </label>
              <UInput
                id="protein-goal"
                v-model="form.proteinGoal"
                type="number"
                min="1"
                step="1"
                inputmode="numeric"
                placeholder="150"
                size="lg"
              />
            </div>

            <div class="space-y-2">
              <label
                for="carbs-goal"
                class="block text-sm font-medium text-highlighted"
              >
                Carbs goal (g)
              </label>
              <UInput
                id="carbs-goal"
                v-model="form.carbsGoal"
                type="number"
                min="1"
                step="1"
                inputmode="numeric"
                placeholder="250"
                size="lg"
              />
            </div>

            <div class="space-y-2">
              <label
                for="fat-goal"
                class="block text-sm font-medium text-highlighted"
              >
                Fat goal (g)
              </label>
              <UInput
                id="fat-goal"
                v-model="form.fatGoal"
                type="number"
                min="1"
                step="1"
                inputmode="numeric"
                placeholder="70"
                size="lg"
              />
            </div>
          </div>

          <p
            v-if="formError"
            class="text-sm text-error"
          >
            {{ formError }}
          </p>

          <p
            v-else-if="saveNotice"
            class="text-sm text-success"
          >
            {{ saveNotice }}
          </p>

          <div
            v-if="hasUnsavedGoalChanges"
            class="flex justify-end"
          >
            <UButton
              type="submit"
              size="lg"
              :loading="isSaving"
            >
              Save goals
            </UButton>
          </div>
        </form>
      </div>
    </UCard>

    <UCard>
      <div class="space-y-4">
        <div class="space-y-3">
          <div class="space-y-2">
            <div class="flex items-start justify-between gap-3">
              <h2 class="text-lg font-semibold text-highlighted">
                Sync
              </h2>

              <UDropdownMenu
                v-if="showSyncActionMenu"
                v-slot="{ open }"
                :items="syncActionMenuItems"
                :content="{ align: 'end' }"
                :ui="{ content: 'min-w-64' }"
              >
                <UButton
                  type="button"
                  color="neutral"
                  variant="soft"
                  icon="i-lucide-ellipsis"
                  aria-label="Open sync actions"
                  :class="[open ? 'bg-elevated' : undefined]"
                />
              </UDropdownMenu>
            </div>

            <p class="text-sm text-muted">
              {{ syncPanelDescription }}
            </p>
          </div>

          <div
            v-if="hasStoredSyncVault"
            class="flex flex-wrap items-center gap-2"
          >
            <UBadge
              :color="syncStatusColor"
              variant="soft"
            >
              Sync status: {{ syncStatusLabel }}
            </UBadge>
            <UBadge
              :color="localSync.isOnline ? 'success' : 'error'"
              variant="soft"
            >
              Internet: {{ localSync.isOnline ? 'Online' : 'Offline' }}
            </UBadge>
            <UBadge
              :color="hasStoredSyncVault ? 'primary' : 'neutral'"
              variant="soft"
            >
              Vault: {{ hasStoredSyncVault ? 'Linked' : 'Not set up' }}
            </UBadge>
          </div>
        </div>

        <template v-if="!hasStoredSyncVault">
          <div class="flex flex-wrap justify-end gap-2">
            <UButton
              type="button"
              color="neutral"
              variant="soft"
              icon="i-lucide-link"
              :disabled="isSyncBootstrapPending || isCreatingSyncPairingRequest"
              @click="openSyncConnectModal"
            >
              Link existing device
            </UButton>

            <UButton
              type="button"
              icon="i-lucide-lock-keyhole"
              :disabled="isSyncBootstrapPending || isCreatingSyncPairingRequest"
              @click="openSyncBootstrapModal"
            >
              Set up encrypted sync
            </UButton>
          </div>

          <div class="grid gap-4 lg:grid-cols-3">
            <div class="rounded-xl border border-default bg-default px-4 py-4">
              <p class="text-xs font-medium uppercase tracking-wide text-muted">
                Fully E2EE
              </p>
              <p class="mt-2 text-sm font-medium text-highlighted">
                Encrypted before upload
              </p>
              <p class="mt-2 text-xs text-muted">
                Your data is encrypted on-device before it leaves this browser and decrypted only on linked devices.
              </p>
            </div>

            <div class="rounded-xl border border-default bg-default px-4 py-4">
              <p class="text-xs font-medium uppercase tracking-wide text-muted">
                Cloud copy
              </p>
              <p class="mt-2 text-sm font-medium text-highlighted">
                Server stores ciphertext
              </p>
              <p class="mt-2 text-xs text-muted">
                Meals, ingredients, settings, and AI integration data stay unreadable to the server.
              </p>
            </div>

            <div class="rounded-xl border border-default bg-default px-4 py-4">
              <p class="text-xs font-medium uppercase tracking-wide text-muted">
                Device linking
              </p>
              <p class="mt-2 text-sm font-medium text-highlighted">
                Approve new devices safely
              </p>
              <p class="mt-2 text-xs text-muted">
                Link a new device from one you already trust, then finish setup locally with your sync passphrase.
              </p>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="rounded-2xl border border-default bg-muted/10 px-4 py-4">
            <div class="space-y-2">
              <p class="text-xs font-medium uppercase tracking-wide text-muted">
                This device
              </p>
              <div>
                <h3 class="text-base font-semibold text-highlighted">
                  {{ syncOverviewTitle }}
                </h3>
                <p class="mt-1 text-sm text-muted">
                  {{ syncOverviewDescription }}
                </p>
              </div>
            </div>
          </div>

          <div class="grid gap-4 lg:grid-cols-3">
            <div class="rounded-xl border border-default bg-default px-4 py-4">
              <p class="text-xs font-medium uppercase tracking-wide text-muted">
                Last successful sync
              </p>
              <p class="mt-2 text-base font-semibold text-highlighted">
                {{ syncLastSuccessSummary }}
              </p>
              <p class="mt-2 text-xs text-muted">
                The most recent completed sync on this device.
              </p>
            </div>

            <div class="rounded-xl border border-default bg-default px-4 py-4">
              <p class="text-xs font-medium uppercase tracking-wide text-muted">
                Linked devices
              </p>
              <p class="mt-2 text-base font-semibold text-highlighted">
                {{ syncDeviceSummary }}
              </p>
              <p class="mt-2 text-xs text-muted">
                Open details to see device names, full IDs, and last seen times.
              </p>
            </div>

            <div class="rounded-xl border border-default bg-default px-4 py-4">
              <p class="text-xs font-medium uppercase tracking-wide text-muted">
                Recent issues
              </p>
              <p class="mt-2 text-base font-semibold text-highlighted">
                {{ syncConflictSummary }}
              </p>
              <p class="mt-2 text-xs text-muted">
                Technical logs, retry info, and conflict history are available in details.
              </p>
            </div>
          </div>

          <p class="text-xs text-muted">
            Export a recovery key after setup. It can restore access if you ever lose your already linked devices.
          </p>
        </template>

        <p
          v-if="syncStatusActionError || localSync.lastError"
          class="text-sm text-error"
        >
          {{ syncStatusActionError || localSync.lastError }}
        </p>

        <p
          v-else-if="syncStatusActionNotice"
          class="text-sm text-success"
        >
          {{ syncStatusActionNotice }}
        </p>
      </div>
    </UCard>

    <UCard>
      <div class="space-y-4">
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-lg font-semibold text-highlighted">
              AI Integration
            </h2>
            <UTooltip text="All settings in this panel are synced to linked devices.">
              <span class="inline-flex">
                <UIcon
                  name="i-lucide-cloud-check"
                  class="size-4 text-primary"
                  aria-hidden="true"
                />
              </span>
            </UTooltip>
          </div>
          <p class="text-sm text-muted">
            Connect one AI provider key and keep it available across linked devices. If sync is enabled, the cloud copy is protected by your encrypted sync vault while the key stays directly usable in this browser.
          </p>
        </div>

        <div
          v-if="!isLoaded"
          class="rounded-lg border border-dashed border-default px-4 py-8 text-center text-sm text-muted"
        >
          Loading AI integration...
        </div>

        <div
          v-else-if="!aiIntegration"
          class="space-y-4 rounded-lg border border-dashed border-default px-4 py-5"
        >
          <p class="text-sm text-muted">
            No AI integration is configured yet.
          </p>

          <div class="flex justify-end">
            <UButton
              type="button"
              icon="i-lucide-shield-check"
              @click="openAiSetupModal"
            >
              Setup AI integration
            </UButton>
          </div>
        </div>

        <div
          v-else
          class="space-y-4"
        >
          <div class="grid gap-4 md:grid-cols-[160px_minmax(0,1fr)]">
            <div class="space-y-1">
              <p class="text-xs font-medium uppercase tracking-wide text-muted">
                Provider
              </p>
              <p class="text-sm font-medium text-highlighted">
                {{ providerLabel(aiIntegration.provider) }}
              </p>
            </div>

            <div class="space-y-1">
              <p class="text-xs font-medium uppercase tracking-wide text-muted">
                Stored key
              </p>
              <div class="flex flex-wrap items-center gap-2">
                <code class="rounded-md border border-default bg-muted/20 px-2 py-1 text-sm text-highlighted">
                  {{ aiIntegration.keyPreview }}…
                </code>
                <UBadge
                  :color="aiIntegrationStatusColor"
                  variant="soft"
                >
                  {{ aiIntegrationStatusLabel }}
                </UBadge>
              </div>
            </div>
          </div>

          <p class="text-xs text-muted">
            <template v-if="hasLegacyEncryptedAiIntegration">
              This key still uses the old local password format. Unlock it once to upgrade it to the simpler synced format.
            </template>
            <template v-else>
              The API key is stored directly in this browser so AI features can use it immediately. If sync is enabled, the cloud copy remains protected by your encrypted sync vault.
            </template>
          </p>

          <p
            v-if="aiIntegrationError"
            class="text-sm text-error"
          >
            {{ aiIntegrationError }}
          </p>

          <p
            v-else-if="aiIntegrationNotice"
            class="text-sm text-success"
          >
            {{ aiIntegrationNotice }}
          </p>

          <div class="flex flex-wrap justify-end gap-2">
            <UButton
              v-if="hasLegacyEncryptedAiIntegration && !isAiUnlocked"
              type="button"
              color="neutral"
              variant="soft"
              icon="i-lucide-unlock"
              :loading="isSavingAiIntegration"
              @click="openAiUnlockModal"
            >
              Upgrade legacy key
            </UButton>

            <UButton
              type="button"
              color="neutral"
              variant="soft"
              icon="i-lucide-refresh-cw"
              :loading="isSavingAiIntegration || isTestingAiIntegrationKey"
              @click="openAiChangeProviderModal"
            >
              Change provider/key
            </UButton>

            <UButton
              type="button"
              color="error"
              variant="soft"
              icon="i-lucide-trash-2"
              :loading="isSavingAiIntegration"
              @click="clearAiIntegrationFromDevice"
            >
              Clear key
            </UButton>
          </div>
        </div>
      </div>
    </UCard>

    <UCard class="border border-error/40 bg-error/5">
      <div class="space-y-4">
        <div>
          <h2 class="text-lg font-semibold text-error">
            Danger Zone
          </h2>
          <p class="text-sm text-muted">
            Clear all local data from this browser (meals, ingredients, and settings). This action cannot be undone.
          </p>
        </div>

        <p
          v-if="dangerError"
          class="text-sm text-error"
        >
          {{ dangerError }}
        </p>

        <p
          v-else-if="dangerNotice"
          class="text-sm text-success"
        >
          {{ dangerNotice }}
        </p>

        <div class="flex justify-end">
          <UButton
            type="button"
            color="error"
            icon="i-lucide-trash-2"
            :loading="isClearingData"
            @click="clearAllLocalData"
          >
            Clear all local data
          </UButton>
        </div>
      </div>
    </UCard>

    <UModal
      v-model:open="isSyncBootstrapModalOpen"
      title="Set up encrypted sync"
      description="Create the first encrypted sync vault on this device. The server will only store ciphertext."
    >
      <template #body>
        <div class="space-y-4">
          <div class="rounded-lg border border-default bg-muted/15 px-4 py-3 text-sm text-muted">
            Your sync passphrase never leaves this browser as plaintext. It is used to unwrap the vault key locally on every device you connect later.
          </div>

          <div class="space-y-2">
            <label
              for="sync-bootstrap-device-name"
              class="block text-sm font-medium text-highlighted"
            >
              Device name
            </label>
            <UInput
              id="sync-bootstrap-device-name"
              v-model="syncBootstrapDeviceName"
              autocomplete="organization-title"
              placeholder="e.g. MacBook browser"
            />
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <div class="space-y-2">
              <label
                for="sync-bootstrap-passphrase"
                class="block text-sm font-medium text-highlighted"
              >
                Sync passphrase
              </label>
              <UInput
                id="sync-bootstrap-passphrase"
                v-model="syncBootstrapPassphrase"
                type="password"
                autocomplete="new-password"
                placeholder="At least 8 characters"
              />
            </div>

            <div class="space-y-2">
              <label
                for="sync-bootstrap-passphrase-confirm"
                class="block text-sm font-medium text-highlighted"
              >
                Confirm passphrase
              </label>
              <UInput
                id="sync-bootstrap-passphrase-confirm"
                v-model="syncBootstrapPassphraseConfirm"
                type="password"
                autocomplete="new-password"
                placeholder="Repeat passphrase"
              />
            </div>
          </div>

          <div class="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
            Anyone with the recovery key can access this vault. Export it immediately after setup and keep it somewhere private.
          </div>

          <p
            v-if="syncBootstrapError"
            class="text-sm text-error"
          >
            {{ syncBootstrapError }}
          </p>
        </div>
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            type="button"
            color="neutral"
            variant="soft"
            :disabled="isSyncBootstrapPending"
            @click="closeSyncBootstrapModal"
          >
            Cancel
          </UButton>

          <UButton
            type="button"
            icon="i-lucide-lock-keyhole"
            :loading="isSyncBootstrapPending"
            @click="submitSyncBootstrap"
          >
            Create encrypted vault
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="isSyncRecoveryModalOpen"
      title="Export recovery key"
      description="Save this somewhere private. It contains the vault token and passphrase needed to recover your encrypted sync vault."
    >
      <template #body>
        <div class="space-y-4">
          <div class="rounded-lg border border-error/40 bg-error/10 px-4 py-3 text-sm text-error">
            Treat this like a password file. Anyone with this recovery key can restore the vault and decrypt its synced data.
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1">
              <p class="text-xs font-medium uppercase tracking-wide text-muted">
                Vault ID
              </p>
              <code class="block break-all rounded-md border border-default bg-muted/20 px-2 py-1 text-sm text-highlighted">
                {{ syncVaultCredentials?.vaultId ?? 'Not ready' }}
              </code>
            </div>

            <div class="space-y-1">
              <p class="text-xs font-medium uppercase tracking-wide text-muted">
                Transport
              </p>
              <p class="text-sm text-highlighted">
                {{ syncTransportModeLabel }}
              </p>
            </div>
          </div>

          <div class="space-y-2">
            <label
              for="sync-recovery-payload"
              class="block text-sm font-medium text-highlighted"
            >
              Recovery key JSON
            </label>
            <UTextarea
              id="sync-recovery-payload"
              v-model="syncRecoveryPayload"
              :rows="12"
              readonly
              spellcheck="false"
              class="w-full font-mono text-xs"
            />
          </div>

          <p
            v-if="syncRecoveryError"
            class="text-sm text-error"
          >
            {{ syncRecoveryError }}
          </p>

          <p
            v-else-if="syncRecoveryNotice"
            class="text-sm text-success"
          >
            {{ syncRecoveryNotice }}
          </p>
        </div>
      </template>

      <template #footer>
        <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <UButton
            type="button"
            color="neutral"
            variant="soft"
            @click="closeSyncRecoveryModal"
          >
            Close
          </UButton>

          <UButton
            type="button"
            color="neutral"
            variant="soft"
            icon="i-lucide-download"
            @click="downloadSyncRecoveryPayload"
          >
            Download JSON
          </UButton>

          <UButton
            type="button"
            icon="i-lucide-copy"
            @click="copySyncRecoveryPayload"
          >
            Copy recovery key
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="isSyncDetailsModalOpen"
      title="Technical sync details"
      description="Technical sync state for this browser, including identifiers, linked devices, and local conflict history."
    >
      <template #body>
        <div class="space-y-5">
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="space-y-1">
              <p class="text-xs font-medium uppercase tracking-wide text-muted">
                Device ID
              </p>
              <code class="block break-all rounded-md border border-default bg-muted/20 px-2 py-1 text-sm text-highlighted">
                {{ localSync.deviceId ?? 'Not set' }}
              </code>
            </div>

            <div class="space-y-1">
              <p class="text-xs font-medium uppercase tracking-wide text-muted">
                Vault ID
              </p>
              <code class="block break-all rounded-md border border-default bg-muted/20 px-2 py-1 text-sm text-highlighted">
                {{ localSync.vaultId ?? 'Not set' }}
              </code>
            </div>
          </div>

          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div class="space-y-1">
              <p class="text-xs font-medium uppercase tracking-wide text-muted">
                Transport
              </p>
              <p class="text-sm text-highlighted">
                {{ syncTransportModeLabel }}
              </p>
            </div>

            <div class="space-y-1">
              <p class="text-xs font-medium uppercase tracking-wide text-muted">
                Engine state
              </p>
              <p class="text-sm text-highlighted">
                {{ statusBadgeLabel(localSync.status) }}
              </p>
            </div>

            <div class="space-y-1">
              <p class="text-xs font-medium uppercase tracking-wide text-muted">
                Trigger
              </p>
              <p class="text-sm text-highlighted">
                {{ localSync.lastTriggerReason ?? 'None yet' }}
              </p>
            </div>

            <div class="space-y-1">
              <p class="text-xs font-medium uppercase tracking-wide text-muted">
                Last attempt
              </p>
              <p class="text-sm text-highlighted">
                {{ formatLocalSyncDateTime(localSync.lastSyncAttemptAt) }}
              </p>
            </div>

            <div class="space-y-1">
              <p class="text-xs font-medium uppercase tracking-wide text-muted">
                Last success
              </p>
              <p class="text-sm text-highlighted">
                {{ formatLocalSyncDateTime(localSync.lastSyncSuccessAt) }}
              </p>
            </div>

            <div class="space-y-1">
              <p class="text-xs font-medium uppercase tracking-wide text-muted">
                Next retry
              </p>
              <p class="text-sm text-highlighted">
                {{ localSync.nextRetryAt ? formatLocalSyncDateTime(localSync.nextRetryAt) : 'Not scheduled' }}
              </p>
            </div>

            <div class="space-y-1">
              <p class="text-xs font-medium uppercase tracking-wide text-muted">
                Error class
              </p>
              <p class="text-sm text-highlighted">
                {{ formatLocalSyncErrorCode(localSync.lastErrorCode) }}
              </p>
            </div>
          </div>

          <div
            v-if="syncStatusActionError || localSync.lastError"
            class="rounded-lg border border-error/40 bg-error/10 px-4 py-3 text-sm text-error"
          >
            {{ syncStatusActionError || localSync.lastError }}
          </div>

          <div class="rounded-xl border border-default bg-muted/10 px-4 py-4">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 class="text-sm font-semibold text-highlighted">
                  Synced devices
                </h3>
                <p class="text-xs text-muted">
                  Devices currently registered in this vault.
                </p>
              </div>

              <UButton
                type="button"
                color="neutral"
                variant="soft"
                size="sm"
                icon="i-lucide-refresh-cw"
                :loading="isSyncDevicesLoading"
                :disabled="!canManageRemoteSyncVault"
                @click="refreshSyncDeviceList(syncVaultCredentials)"
              >
                Refresh
              </UButton>
            </div>

            <p
              v-if="syncDevicesError"
              class="mt-3 text-sm text-error"
            >
              {{ syncDevicesError }}
            </p>

            <div
              v-else-if="isSyncDevicesLoading"
              class="mt-3 text-sm text-muted"
            >
              Loading devices...
            </div>

            <div
              v-else-if="!syncDevices.length"
              class="mt-3 text-sm text-muted"
            >
              {{ canManageRemoteSyncVault ? 'No synced devices reported yet.' : 'Connect to a sync vault to load the device list.' }}
            </div>

            <div
              v-else
              class="mt-3 space-y-2"
            >
              <div
                v-for="device in syncDevices"
                :key="device.deviceId"
                class="rounded-lg border border-default bg-default px-3 py-3"
              >
                <div class="space-y-2">
                  <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p class="text-sm font-medium text-highlighted">
                        {{ device.deviceName }}
                      </p>
                      <p class="text-xs text-muted">
                        Last seen {{ formatLocalSyncDateTime(device.lastSeenAt) }}
                      </p>
                    </div>
                  </div>

                  <div class="space-y-1">
                    <p class="text-xs font-medium uppercase tracking-wide text-muted">
                      Device ID
                    </p>
                    <code class="block break-all rounded-md border border-default bg-muted/20 px-2 py-1 text-xs text-highlighted">
                      {{ device.deviceId }}
                    </code>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="rounded-xl border border-default bg-muted/10 px-4 py-4">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div class="flex items-center gap-2">
                  <h3 class="text-sm font-semibold text-highlighted">
                    Local conflict log
                  </h3>
                  <UBadge
                    color="neutral"
                    variant="soft"
                  >
                    {{ syncConflictEntries.length }}
                  </UBadge>
                </div>
                <p class="text-xs text-muted">
                  Remote wins and payload decode failures logged on this device.
                </p>
              </div>

              <UButton
                type="button"
                color="neutral"
                variant="soft"
                size="sm"
                icon="i-lucide-refresh-cw"
                :loading="isSyncConflictsLoading"
                @click="refreshSyncConflictEntries"
              >
                Refresh
              </UButton>
            </div>

            <p
              v-if="syncConflictsError"
              class="mt-3 text-sm text-error"
            >
              {{ syncConflictsError }}
            </p>

            <div
              v-else-if="isSyncConflictsLoading"
              class="mt-3 text-sm text-muted"
            >
              Loading conflict log...
            </div>

            <div
              v-else-if="!syncConflictEntries.length"
              class="mt-3 text-sm text-muted"
            >
              No sync conflicts logged on this device yet.
            </div>

            <div
              v-else
              class="mt-3 space-y-2"
            >
              <div
                v-for="entry in syncConflictEntries"
                :key="entry.id"
                class="rounded-lg border border-default bg-default px-3 py-3"
              >
                <div class="space-y-2">
                  <div class="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p class="text-sm font-medium text-highlighted">
                        {{ entry.collectionName }}
                      </p>
                      <p class="text-xs text-muted">
                        {{ entry.reason }}
                      </p>
                    </div>

                    <p class="text-xs text-muted">
                      {{ formatLocalSyncDateTime(entry.createdAt) }}
                    </p>
                  </div>

                  <div class="space-y-1">
                    <p class="text-xs font-medium uppercase tracking-wide text-muted">
                      Document ID
                    </p>
                    <code class="block break-all rounded-md border border-default bg-muted/20 px-2 py-1 text-xs text-highlighted">
                      {{ entry.documentId }}
                    </code>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            type="button"
            color="neutral"
            variant="soft"
            @click="isSyncDetailsModalOpen = false"
          >
            Close
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="isSyncDeleteCloudModalOpen"
      title="Delete cloud sync copy"
      description="This permanently removes the server-side vault, encrypted documents, and registered devices. Local data in this browser will be kept."
    >
      <template #body>
        <div class="space-y-4">
          <div class="rounded-lg border border-error/40 bg-error/10 px-4 py-3 text-sm text-error">
            This cannot be undone. After deletion, every connected device will lose access to the cloud copy until a new vault is created.
          </div>

          <div class="space-y-1">
            <p class="text-xs font-medium uppercase tracking-wide text-muted">
              Confirm vault ID
            </p>
            <code class="block break-all rounded-md border border-default bg-muted/20 px-2 py-1 text-sm text-highlighted">
              {{ syncVaultCredentials?.vaultId ?? 'Not ready' }}
            </code>
          </div>

          <div class="space-y-2">
            <label
              for="sync-delete-cloud-confirm"
              class="block text-sm font-medium text-highlighted"
            >
              Type the vault ID to confirm
            </label>
            <UInput
              id="sync-delete-cloud-confirm"
              v-model="syncDeleteCloudConfirmValue"
              autocomplete="off"
              spellcheck="false"
              placeholder="Paste the full vault ID"
            />
          </div>

          <p
            v-if="syncDeleteCloudError"
            class="text-sm text-error"
          >
            {{ syncDeleteCloudError }}
          </p>
        </div>
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            type="button"
            color="neutral"
            variant="soft"
            :disabled="isSyncDeleteCloudPending"
            @click="closeSyncDeleteCloudModal"
          >
            Cancel
          </UButton>

          <UButton
            type="button"
            color="error"
            icon="i-lucide-cloud-off"
            :loading="isSyncDeleteCloudPending"
            :disabled="!syncDeleteCloudConfirmationMatches"
            @click="confirmDeleteCloudSyncCopy"
          >
            Delete cloud copy
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="isSyncConnectModalOpen"
      title="Connect to existing device"
      :description="syncConnectModalDescription"
    >
      <template #body>
        <div class="space-y-4">
          <template v-if="isSyncConnectAwaitingPassphrase">
            <div class="rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
              This device was approved. Enter the sync passphrase to finish linking.
            </div>

            <div class="space-y-2">
              <label
                for="sync-connect-passphrase"
                class="block text-sm font-medium text-highlighted"
              >
                Sync passphrase
              </label>
              <UInput
                id="sync-connect-passphrase"
                v-model="syncConnectPassphrase"
                type="password"
                autocomplete="current-password"
                placeholder="Enter the same passphrase used when the vault was created"
              />
              <p class="text-xs text-muted">
                The passphrase never leaves this browser. It is used locally to unwrap the encrypted vault key and start sync on this device.
              </p>
            </div>
          </template>

          <template v-else>
            <div class="rounded-lg border border-default bg-muted/15 px-4 py-3 text-sm text-muted">
              Do not enable sync first on this device. Keep this modal open, approve the code from an already synced device, then enter the same sync passphrase here.
            </div>

            <div
              v-if="syncConnectQrHostWarning && isSyncConnectQrExpanded"
              class="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning"
            >
              {{ syncConnectQrHostWarning }}
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
              <div class="space-y-1">
                <p class="text-xs font-medium uppercase tracking-wide text-muted">
                  This device
                </p>
                <p class="text-sm text-highlighted">
                  {{ syncPairingRequest?.requesterDeviceName ?? 'Preparing request' }}
                </p>
              </div>

              <div class="space-y-1">
                <p class="text-xs font-medium uppercase tracking-wide text-muted">
                  Code expires
                </p>
                <p class="text-sm text-highlighted">
                  {{ formatLocalSyncDateTime(syncPairingRequest?.expiresAt ?? null) }}
                </p>
              </div>
            </div>

            <div class="rounded-xl border border-default bg-muted/10 px-4 py-5 text-center">
              <p class="text-xs font-medium uppercase tracking-[0.24em] text-muted">
                Pairing code
              </p>
              <p class="mt-2 font-mono text-4xl font-semibold tracking-[0.4em] text-highlighted sm:text-5xl">
                {{ formatSyncPairingCode(syncPairingRequest?.pairingCode) }}
              </p>
              <p class="mt-3 text-sm text-muted">
                Codes are case-sensitive.
              </p>
            </div>

            <div class="flex justify-center">
              <UButton
                type="button"
                color="neutral"
                variant="soft"
                icon="i-lucide-qr-code"
                :loading="isGeneratingSyncConnectQr"
                @click="toggleSyncConnectQr"
              >
                {{ isSyncConnectQrExpanded ? 'Hide QR code' : 'Show QR code' }}
              </UButton>
            </div>

            <div
              v-if="isSyncConnectQrExpanded"
              class="rounded-xl border border-default bg-muted/10 px-4 py-5"
            >
              <div class="flex justify-center">
                <div class="rounded-[28px] border border-default bg-white p-3 shadow-sm">
                  <img
                    v-if="syncConnectQrDataUrl"
                    :src="syncConnectQrDataUrl"
                    alt="QR code for authorizing this device"
                    class="size-52 rounded-[20px]"
                  >
                </div>
              </div>

              <p class="mt-4 text-center text-sm text-muted">
                Scan this on the already synced device to open the authorize dialog with the code prefilled.
              </p>
            </div>

            <div class="rounded-lg border border-default bg-muted/15 px-4 py-3 text-sm">
              <p class="font-medium text-highlighted">
                Status: {{ syncPairingStatus === 'expired' ? 'Expired' : syncPairingStatus === 'approved' ? 'Approved' : 'Waiting for authorization' }}
              </p>
              <p class="mt-1 text-muted">
                Enter this code on the already synced device under “Authorize new device”.
              </p>
            </div>
          </template>

          <p
            v-if="syncConnectError"
            class="text-sm text-error"
          >
            {{ syncConnectError }}
          </p>
        </div>
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            type="button"
            color="neutral"
            variant="soft"
            @click="closeSyncConnectModal"
          >
            Close
          </UButton>

          <UButton
            v-if="syncPairingStatus === 'expired'"
            type="button"
            icon="i-lucide-refresh-cw"
            :loading="isCreatingSyncPairingRequest"
            @click="openSyncConnectModal"
          >
            Generate new code
          </UButton>

          <UButton
            v-if="syncPairingStatus === 'approved' && syncPairingApprovedCredentials"
            type="button"
            icon="i-lucide-link"
            :loading="isCompletingSyncPairingConnect"
            @click="completeSyncConnectPairing"
          >
            Finish linking
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="isSyncAuthorizeModalOpen"
      title="Authorize new device"
      description="Enter the 6-character code shown on the device that needs access to this sync vault."
    >
      <template #body>
        <div class="space-y-4">
          <div class="rounded-lg border border-default bg-muted/15 px-4 py-3 text-sm text-muted">
            This grants the requesting device access to this encrypted vault while it keeps its own device ID. The user will still need the sync passphrase on that device to finish linking.
          </div>

          <div class="space-y-1">
            <p class="text-xs font-medium uppercase tracking-wide text-muted">
              Current vault
            </p>
            <code class="block break-all rounded-md border border-default bg-muted/20 px-2 py-1 text-sm text-highlighted">
              {{ syncVaultCredentials?.vaultId ?? 'Not ready' }}
            </code>
          </div>

          <div class="space-y-2">
            <label
              for="sync-pairing-code"
              class="block text-sm font-medium text-highlighted"
            >
              Pairing code
            </label>

            <div
              v-if="hasSyncAuthorizeCamera || isCheckingSyncAuthorizeCamera"
              class="space-y-2 rounded-lg border border-default bg-muted/10 px-3 py-3"
            >
              <div class="flex flex-wrap items-center gap-2">
                <UButton
                  type="button"
                  color="neutral"
                  variant="soft"
                  icon="i-lucide-camera"
                  :loading="isCheckingSyncAuthorizeCamera || isStartingSyncAuthorizeScanner"
                  @click="toggleSyncAuthorizeScanner"
                >
                  {{ isSyncAuthorizeScannerOpen ? 'Stop scanning' : 'Scan QR code' }}
                </UButton>

                <p class="text-xs text-muted">
                  Scan the QR code shown on the other device and the pairing code will fill in automatically.
                </p>
              </div>

              <div
                v-if="isSyncAuthorizeScannerOpen"
                class="overflow-hidden rounded-xl border border-default bg-black"
              >
                <video
                  ref="syncAuthorizeScannerVideo"
                  class="aspect-square w-full bg-black object-cover"
                  muted
                  playsinline
                />
              </div>
            </div>

            <UInput
              id="sync-pairing-code"
              v-model="syncAuthorizeCode"
              size="lg"
              maxlength="6"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              placeholder="Ab3X9q"
              class="font-mono"
            />
            <p class="text-xs text-muted">
              Enter the code exactly as shown. Codes are case-sensitive.
            </p>
          </div>

          <p
            v-if="syncAuthorizeScannerError"
            class="text-sm text-error"
          >
            {{ syncAuthorizeScannerError }}
          </p>

          <p
            v-if="syncAuthorizeError"
            class="text-sm text-error"
          >
            {{ syncAuthorizeError }}
          </p>
        </div>
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            type="button"
            color="neutral"
            variant="soft"
            :disabled="isAuthorizingSyncPairing"
            @click="closeSyncAuthorizeModal"
          >
            Cancel
          </UButton>

          <UButton
            type="button"
            icon="i-lucide-shield-check"
            :loading="isAuthorizingSyncPairing"
            @click="authorizeSyncPairingCode"
          >
            Authorize device
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="isAiSetupModalOpen"
      title="Setup AI integration"
      description="Choose a provider and API key. The key will be tested before being saved."
    >
      <template #body>
        <div class="space-y-4">
          <div class="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
            <div class="space-y-2">
              <label
                for="ai-setup-provider"
                class="block text-sm font-medium text-highlighted"
              >
                Provider
              </label>
              <USelect
                id="ai-setup-provider"
                v-model="aiSetupProvider"
                :items="AI_PROVIDER_OPTIONS"
                class="w-full"
              />
            </div>

            <div class="space-y-2">
              <label
                for="ai-setup-api-key"
                class="block text-sm font-medium text-highlighted"
              >
                {{ providerLabel(aiSetupProvider) }} API key
              </label>
              <UInput
                id="ai-setup-api-key"
                v-model="aiSetupApiKey"
                type="password"
                autocomplete="off"
                :placeholder="aiSetupProvider === 'openai' ? 'sk-...' : 'sk-ant-...'"
              />
            </div>
          </div>

          <div class="rounded-lg border border-default bg-muted/15 px-4 py-3 text-sm text-muted">
            The key is saved directly in this browser for immediate use. If sync is enabled, the cloud copy is protected by your encrypted sync vault.
          </div>

          <p
            v-if="aiSetupError"
            class="text-sm text-error"
          >
            {{ aiSetupError }}
          </p>
        </div>
      </template>

      <template #footer>
        <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            :disabled="isSavingAiIntegration || isTestingAiIntegrationKey"
            @click="closeAiSetupModal"
          >
            Cancel
          </UButton>

          <UButton
            type="button"
            icon="i-lucide-shield-check"
            :loading="isSavingAiIntegration || isTestingAiIntegrationKey"
            @click="saveAiIntegrationSetup"
          >
            Test & save
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="isAiUnlockModalOpen"
      title="Upgrade legacy AI integration"
      description="This key still uses the old browser-only 4-digit password format. Enter it once to unlock and upgrade the key."
    >
      <template #body>
        <form
          class="space-y-4"
          @submit.prevent="submitAiUnlock"
        >
          <div class="space-y-2">
            <label
              for="ai-unlock-pin"
              class="block text-sm font-medium text-highlighted"
            >
              Legacy encryption password (4 digits)
            </label>
            <UInput
              id="ai-unlock-pin"
              v-model="aiUnlockPin"
              type="password"
              inputmode="numeric"
              autocomplete="off"
              maxlength="4"
              placeholder="1234"
            />
          </div>

          <p
            v-if="aiUnlockError"
            class="text-sm text-error"
          >
            {{ aiUnlockError }}
          </p>

          <div class="flex flex-col-reverse items-end gap-2 sm:flex-row sm:justify-end">
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              :disabled="isSavingAiIntegration"
              @click="closeAiUnlockModal"
            >
              Cancel
            </UButton>
            <UButton
              type="submit"
              icon="i-lucide-unlock"
              :loading="isSavingAiIntegration"
            >
              Upgrade key
            </UButton>
          </div>
        </form>
      </template>
    </UModal>

    <UModal
      v-model:open="isAiChangeProviderModalOpen"
      title="Change provider/key"
      description="Provide a new provider API key. The key is tested before replacing the current one."
    >
      <template #body>
        <form
          class="space-y-4"
          @submit.prevent="submitAiChangeProvider"
        >
          <div class="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
            <div class="space-y-2">
              <label
                for="ai-change-provider-select"
                class="block text-sm font-medium text-highlighted"
              >
                Provider
              </label>
              <USelect
                id="ai-change-provider-select"
                v-model="aiChangeProviderProvider"
                :items="AI_PROVIDER_OPTIONS"
                class="w-full"
              />
            </div>

            <div class="space-y-2">
              <label
                for="ai-change-provider-api-key"
                class="block text-sm font-medium text-highlighted"
              >
                {{ providerLabel(aiChangeProviderProvider) }} API key
              </label>
              <UInput
                id="ai-change-provider-api-key"
                v-model="aiChangeProviderApiKey"
                type="password"
                autocomplete="off"
                :placeholder="aiChangeProviderProvider === 'openai' ? 'sk-...' : 'sk-ant-...'"
              />
            </div>
          </div>

          <p
            v-if="aiChangeProviderError"
            class="text-sm text-error"
          >
            {{ aiChangeProviderError }}
          </p>

          <div class="flex flex-col-reverse items-end gap-2 sm:flex-row sm:justify-end">
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              :disabled="isSavingAiIntegration || isTestingAiIntegrationKey"
              @click="closeAiChangeProviderModal"
            >
              Cancel
            </UButton>
            <UButton
              type="submit"
              icon="i-lucide-refresh-cw"
              :loading="isSavingAiIntegration || isTestingAiIntegrationKey"
            >
              Test & save
            </UButton>
          </div>
        </form>
      </template>
    </UModal>

    <UModal
      v-model:open="isRecommendationModalOpen"
      title="Recommended goals"
      description="General estimate for daily calories and macros. Review before saving."
    >
      <template #body>
        <div class="space-y-4">
          <div class="grid gap-4 sm:grid-cols-3">
            <div class="space-y-2">
              <label
                for="rec-age"
                class="block text-sm font-medium text-highlighted"
              >
                Age
              </label>
              <UInput
                id="rec-age"
                v-model="recommendationForm.age"
                type="number"
                min="13"
                max="120"
                step="1"
                inputmode="numeric"
                placeholder="30"
              />
            </div>

            <div class="space-y-2">
              <label
                for="rec-height-cm"
                class="block text-sm font-medium text-highlighted"
              >
                Height (cm)
              </label>
              <UInput
                id="rec-height-cm"
                v-model="recommendationForm.heightCm"
                type="number"
                min="100"
                max="250"
                step="1"
                inputmode="decimal"
                placeholder="170"
              />
            </div>

            <div class="space-y-2">
              <label
                for="rec-weight-kg"
                class="block text-sm font-medium text-highlighted"
              >
                Weight (kg)
              </label>
              <UInput
                id="rec-weight-kg"
                v-model="recommendationForm.weightKg"
                type="number"
                min="25"
                max="400"
                step="0.1"
                inputmode="decimal"
                placeholder="70"
              />
            </div>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <div class="space-y-2">
              <label
                for="rec-sex"
                class="block text-sm font-medium text-highlighted"
              >
                Sex
              </label>
              <USelect
                id="rec-sex"
                v-model="recommendationForm.sex"
                :items="RECOMMENDATION_SEX_OPTIONS"
                class="w-full"
              />
            </div>

            <div class="space-y-2">
              <label
                for="rec-activity"
                class="block text-sm font-medium text-highlighted"
              >
                Activity level
              </label>
              <USelect
                id="rec-activity"
                v-model="recommendationForm.activityLevel"
                :items="RECOMMENDATION_ACTIVITY_OPTIONS"
                class="w-full"
              />
            </div>
          </div>

          <div class="space-y-2">
            <label
              for="rec-objective"
              class="block text-sm font-medium text-highlighted"
            >
              Objective
            </label>
            <USelect
              id="rec-objective"
              v-model="recommendationForm.objective"
              :items="RECOMMENDATION_OBJECTIVE_OPTIONS"
              class="w-full"
            />
          </div>

          <p class="text-xs text-muted">
            Uses a Mifflin-St Jeor BMR estimate, activity multipliers, and general macro split heuristics. This is not medical advice.
          </p>

          <p
            v-if="recommendationError"
            class="text-sm text-error"
          >
            {{ recommendationError }}
          </p>
        </div>
      </template>

      <template #footer="{ close }">
        <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            @click="close()"
          >
            Cancel
          </UButton>
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            @click="resetRecommendationInputs"
          >
            Clear
          </UButton>
          <UButton
            type="button"
            icon="i-lucide-wand-sparkles"
            @click="applyRecommendedGoals"
          >
            Apply recommendations
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
