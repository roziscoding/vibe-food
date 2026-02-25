<script setup lang="ts">
import { readClientCollection, writeClientCollection } from '../utils/client-db'
import { extractIngredientFromNutritionLabelImage } from '../utils/ai-ingredient-import'
import {
  getUnlockedAiIntegration,
  isAiIntegrationUnlocked,
  readAiIntegrationMetadata,
  unlockAiIntegration
} from '../utils/client-ai-integration'
import { DEFAULT_AI_PROVIDER } from '../utils/client-settings'
import type { AiProvider } from '../utils/client-settings'
import { MACRO_COLORS } from '../utils/nutrition-colors'

interface IngredientEntry {
  id: string
  uuid: string
  name: string
  unit: string
  portionSize: number
  kcal: number
  protein: number
  carbs: number
  fat: number
  kcalPerUnit: number
  proteinPerUnit: number
  carbsPerUnit: number
  fatPerUnit: number
  createdAt: string
}

type IngredientFormState = {
  name: string
  portionSize: string
  unit: string
  kcal: string
  protein: string
  carbs: string
  fat: string
}

type IngredientDraftValues = {
  name: string
  unit: string
  portionSize: number
  kcal: number
  protein: number
  carbs: number
  fat: number
}

const INGREDIENTS_COLLECTION_KEY = 'ingredients'

const ingredients = ref<IngredientEntry[]>([])
const storageLoaded = ref(false)
const isIngredientEditorModalOpen = ref(false)
const ingredientEditorMode = ref<'create' | 'edit'>('create')
const editingIngredientId = ref<string | null>(null)
const ingredientEditorError = ref('')
const isImportIngredientModalOpen = ref(false)
const isExportModalOpen = ref(false)
const isAiImportIngredientModalOpen = ref(false)
const isAiKeyMissingModalOpen = ref(false)
const isAiUnlockModalOpen = ref(false)
const importIngredientJson = ref('')
const importIngredientError = ref('')
const exportCopyNotice = ref('')
const exportCopyError = ref('')
const aiIntegration = ref<Awaited<ReturnType<typeof readAiIntegrationMetadata>>>(null)
const isAiIntegrationUnlockedForSession = ref(false)
const aiAvailabilityMode = ref<'missing' | 'locked'>('missing')
const aiIngredientImportError = ref('')
const isAnalyzingIngredientImage = ref(false)
const aiUnlockPin = ref('')
const aiUnlockError = ref('')
const isUnlockingAiIntegration = ref(false)
const aiNutritionImageDataUrl = ref('')
const aiNutritionImageFileName = ref('')
const ingredientEditorForm = reactive<IngredientFormState>({
  name: '',
  portionSize: '',
  unit: 'g',
  kcal: '',
  protein: '',
  carbs: '',
  fat: ''
})

const sortedIngredients = computed(() => {
  return [...ingredients.value].sort((a, b) => a.name.localeCompare(b.name))
})

const selectedAiProvider = computed<AiProvider>(() => {
  return aiIntegration.value?.provider ?? DEFAULT_AI_PROVIDER
})

const selectedAiProviderLabel = computed(() => {
  return selectedAiProvider.value === 'openai' ? 'OpenAI' : 'Anthropic'
})

const aiAvailabilityModalTitle = computed(() => {
  return aiAvailabilityMode.value === 'locked'
    ? 'Unlock AI integration'
    : 'AI integration required'
})

const aiAvailabilityModalDescription = computed(() => {
  return aiAvailabilityMode.value === 'locked'
    ? `Your ${selectedAiProviderLabel.value} key is configured but locked. Unlock it to use AI ingredient import.`
    : 'Set up an encrypted AI provider key in Settings before using AI ingredient import.'
})

const ingredientExportPayload = computed(() => {
  return sortedIngredients.value.map(ingredient => ({
    name: ingredient.name,
    uuid: ingredient.uuid,
    unit: ingredient.unit
  }))
})

const ingredientExportJson = computed(() => {
  return JSON.stringify(ingredientExportPayload.value, null, 2)
})

onMounted(async () => {
  const [loadedIngredients, aiMetadata] = await Promise.all([
    loadIngredientsFromDb(),
    readAiIntegrationMetadata().catch((error) => {
      console.error('Failed to read AI integration metadata from IndexedDB', error)
      return null
    })
  ])

  ingredients.value = loadedIngredients
  aiIntegration.value = aiMetadata
  isAiIntegrationUnlockedForSession.value = isAiIntegrationUnlocked()
  storageLoaded.value = true
})

watch(ingredients, (value) => {
  if (!storageLoaded.value) {
    return
  }

  void persistIngredientsToDb(value)
}, { deep: true })

watch(isIngredientEditorModalOpen, (isOpen) => {
  if (!isOpen) {
    resetIngredientEditorModal()
  }
})

watch(isImportIngredientModalOpen, (isOpen) => {
  if (!isOpen) {
    resetImportIngredientModal()
  }
})

watch(isAiImportIngredientModalOpen, (isOpen) => {
  if (!isOpen) {
    resetAiImportIngredientModal()
  }
})

watch(isAiUnlockModalOpen, (isOpen) => {
  if (!isOpen) {
    resetAiUnlockModal()
  }
})

async function persistIngredientsToDb(value: IngredientEntry[]) {
  try {
    await writeClientCollection(INGREDIENTS_COLLECTION_KEY, value)
  }
  catch (error) {
    console.error('Failed to persist ingredients to IndexedDB', error)
  }
}

async function copyIngredientExportJson() {
  exportCopyNotice.value = ''
  exportCopyError.value = ''

  try {
    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
      throw new Error('Clipboard API unavailable')
    }

    await navigator.clipboard.writeText(ingredientExportJson.value)
    exportCopyNotice.value = 'Export JSON copied.'
  }
  catch (error) {
    console.error('Failed to copy ingredient export JSON', error)
    exportCopyError.value = 'Could not copy to clipboard.'
  }
}

function openCreateIngredientModal(prefill?: Partial<IngredientDraftValues>) {
  ingredientEditorMode.value = 'create'
  editingIngredientId.value = null
  ingredientEditorError.value = ''
  resetIngredientDraft(ingredientEditorForm)

  if (prefill) {
    fillIngredientDraftFromValues(ingredientEditorForm, prefill)
  }

  isIngredientEditorModalOpen.value = true
}

function openEditIngredientModal(ingredient: IngredientEntry) {
  ingredientEditorMode.value = 'edit'
  editingIngredientId.value = ingredient.id
  ingredientEditorError.value = ''
  fillIngredientDraftFromIngredient(ingredientEditorForm, ingredient)
  isIngredientEditorModalOpen.value = true
}

function closeIngredientEditorModal() {
  isIngredientEditorModalOpen.value = false
}

function resetIngredientEditorModal() {
  ingredientEditorError.value = ''
  editingIngredientId.value = null
  ingredientEditorMode.value = 'create'
  resetIngredientDraft(ingredientEditorForm)
}

function submitIngredientEditor() {
  ingredientEditorError.value = ''

  const parsed = parseIngredientDraft(ingredientEditorForm)

  if (!parsed.values) {
    ingredientEditorError.value = parsed.error
    return
  }

  if (ingredientEditorMode.value === 'edit' && editingIngredientId.value) {
    const existing = ingredients.value.find(ingredient => ingredient.id === editingIngredientId.value)

    if (!existing) {
      ingredientEditorError.value = 'Ingredient not found.'
      return
    }

    const updated = createIngredientEntry(parsed.values, existing)
    ingredients.value = ingredients.value.map(ingredient => (
      ingredient.id === existing.id ? updated : ingredient
    ))
    closeIngredientEditorModal()
    return
  }

  ingredients.value = [createIngredientEntry(parsed.values), ...ingredients.value]
  closeIngredientEditorModal()
}

function removeIngredient(id: string) {
  ingredients.value = ingredients.value.filter(ingredient => ingredient.id !== id)
}

function openImportIngredientModal() {
  resetImportIngredientModal()
  isImportIngredientModalOpen.value = true
}

function closeImportIngredientModal() {
  isImportIngredientModalOpen.value = false
}

function resetImportIngredientModal() {
  importIngredientJson.value = ''
  importIngredientError.value = ''
}

async function openAiImportIngredientFlow() {
  aiIngredientImportError.value = ''

  if (!storageLoaded.value) {
    aiIngredientImportError.value = 'Ingredients are still loading. Try again in a moment.'
    return
  }

  await refreshAiIntegrationAvailability()

  if (!aiIntegration.value) {
    aiAvailabilityMode.value = 'missing'
    isAiKeyMissingModalOpen.value = true
    return
  }

  if (!isAiIntegrationUnlockedForSession.value || !getUnlockedAiIntegration()) {
    openAiUnlockModal()
    return
  }

  openAiImportIngredientModal()
}

function openAiImportIngredientModal() {
  aiIngredientImportError.value = ''
  isAiImportIngredientModalOpen.value = true
}

function closeAiImportIngredientModal() {
  isAiImportIngredientModalOpen.value = false
}

function resetAiImportIngredientModal() {
  aiIngredientImportError.value = ''
  aiNutritionImageDataUrl.value = ''
  aiNutritionImageFileName.value = ''
}

function closeAiKeyMissingModal() {
  isAiKeyMissingModalOpen.value = false
}

function openAiUnlockModal() {
  aiUnlockError.value = ''
  aiUnlockPin.value = ''
  isAiUnlockModalOpen.value = true
}

function closeAiUnlockModal() {
  isAiUnlockModalOpen.value = false
}

function resetAiUnlockModal() {
  aiUnlockError.value = ''
  aiUnlockPin.value = ''
}

async function submitAiUnlock() {
  aiUnlockError.value = ''

  const pin = aiUnlockPin.value.trim()

  if (!pin) {
    aiUnlockError.value = 'Enter your 4-digit encryption password.'
    return
  }

  isUnlockingAiIntegration.value = true

  try {
    aiIntegration.value = await unlockAiIntegration(pin)
    isAiIntegrationUnlockedForSession.value = true
    closeAiUnlockModal()
    openAiImportIngredientModal()
  }
  catch (error) {
    aiUnlockError.value = error instanceof Error ? error.message : 'Could not unlock AI integration.'
  }
  finally {
    isUnlockingAiIntegration.value = false
  }
}

async function refreshAiIntegrationAvailability() {
  try {
    aiIntegration.value = await readAiIntegrationMetadata()
  }
  catch (error) {
    console.error('Failed to read AI integration metadata from IndexedDB', error)
    aiIntegration.value = null
  }

  isAiIntegrationUnlockedForSession.value = isAiIntegrationUnlocked()
}

async function handleAiNutritionImageChange(event: Event) {
  aiIngredientImportError.value = ''

  const input = event.target as HTMLInputElement | null
  const file = input?.files?.[0]

  if (!file) {
    return
  }

  if (!file.type.startsWith('image/')) {
    aiIngredientImportError.value = 'Select an image file.'
    if (input) {
      input.value = ''
    }
    return
  }

  try {
    aiNutritionImageDataUrl.value = await readFileAsDataUrl(file)
    aiNutritionImageFileName.value = file.name
  }
  catch (error) {
    console.error('Failed to read nutrition label image', error)
    aiIngredientImportError.value = 'Could not read the selected image.'
  }
  finally {
    if (input) {
      input.value = ''
    }
  }
}

async function analyzeNutritionLabelWithAi() {
  aiIngredientImportError.value = ''

  if (!aiNutritionImageDataUrl.value) {
    aiIngredientImportError.value = 'Select an image of the nutrition facts label first.'
    return
  }

  await refreshAiIntegrationAvailability()

  const unlockedAiIntegration = getUnlockedAiIntegration()

  if (!unlockedAiIntegration || !unlockedAiIntegration.apiKey.trim()) {
    closeAiImportIngredientModal()
    if (aiIntegration.value) {
      openAiUnlockModal()
    }
    else {
      aiAvailabilityMode.value = 'missing'
      isAiKeyMissingModalOpen.value = true
    }
    return
  }

  isAnalyzingIngredientImage.value = true

  try {
    const payload = await extractIngredientFromNutritionLabelImage({
      provider: unlockedAiIntegration.provider,
      apiKey: unlockedAiIntegration.apiKey.trim(),
      imageDataUrl: aiNutritionImageDataUrl.value
    })

    closeAiImportIngredientModal()
    openCreateIngredientModal({
      name: payload.product_name === '-' ? '' : payload.product_name,
      unit: payload.portion_unit,
      portionSize: payload.portion_size,
      kcal: payload.calories,
      protein: payload.macros_per_portion.protein_g,
      carbs: payload.macros_per_portion.carbohydrates_g,
      fat: payload.macros_per_portion.total_fat_g
    })
  }
  catch (error) {
    console.error('Failed to extract ingredient from nutrition label image', error)
    const message = error instanceof Error ? error.message : 'Unknown error'

    if (/failed to fetch/i.test(message)) {
      aiIngredientImportError.value = 'Network request failed. This may be blocked by browser/provider CORS. Try again or use JSON import.'
      return
    }

    aiIngredientImportError.value = message
  }
  finally {
    isAnalyzingIngredientImage.value = false
  }
}

function openIngredientEditorFromNutritionPayload(payload: {
  productName: string
  portionUnit: string
  portionSize: number
  calories: number
  protein: number
  carbs: number
  fat: number
}) {
  openCreateIngredientModal({
    name: payload.productName === '-' ? '' : payload.productName,
    unit: payload.portionUnit,
    portionSize: payload.portionSize,
    kcal: payload.calories,
    protein: payload.protein,
    carbs: payload.carbs,
    fat: payload.fat
  })
}

function parseImportIngredientJson() {
  importIngredientError.value = ''

  const jsonInput = importIngredientJson.value.trim()

  if (!jsonInput) {
    importIngredientError.value = 'Paste the product JSON first.'
    return
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(normalizeJsonText(jsonInput))
  }
  catch {
    importIngredientError.value = 'The pasted text is not valid JSON.'
    return
  }

  if (!parsed || typeof parsed !== 'object') {
    importIngredientError.value = 'Expected a JSON object.'
    return
  }

  const payload = parsed as Record<string, unknown>
  const macros = payload.macros_per_portion

  if (!macros || typeof macros !== 'object') {
    importIngredientError.value = 'Missing macros_per_portion object.'
    return
  }

  const macrosPayload = macros as Record<string, unknown>
  const productName = typeof payload.product_name === 'string' ? payload.product_name.trim() : ''
  const portionUnit = typeof payload.portion_unit === 'string' ? payload.portion_unit.trim() : ''
  const portionSize = payload.portion_size
  const calories = payload.calories
  const protein = macrosPayload.protein_g
  const carbs = macrosPayload.carbohydrates_g
  const fat = macrosPayload.total_fat_g

  if (!portionUnit) {
    importIngredientError.value = 'portion_unit must be a non-empty string.'
    return
  }

  if (typeof portionSize !== 'number' || !Number.isFinite(portionSize) || portionSize <= 0) {
    importIngredientError.value = 'portion_size must be a number greater than 0.'
    return
  }

  if (typeof calories !== 'number' || !Number.isFinite(calories) || calories < 0) {
    importIngredientError.value = 'calories must be zero or a positive number.'
    return
  }

  if (
    typeof protein !== 'number' || !Number.isFinite(protein) || protein < 0
    || typeof carbs !== 'number' || !Number.isFinite(carbs) || carbs < 0
    || typeof fat !== 'number' || !Number.isFinite(fat) || fat < 0
  ) {
    importIngredientError.value = 'macros_per_portion values must be zero or positive numbers.'
    return
  }

  closeImportIngredientModal()
  openIngredientEditorFromNutritionPayload({
    productName,
    portionUnit,
    portionSize,
    calories,
    protein,
    carbs,
    fat
  })
}

function parseIngredientDraft(source: IngredientFormState) {
  const name = source.name.trim()
  const unit = source.unit.trim() || 'g'
  const portionSize = Number(source.portionSize)
  const kcal = Number(source.kcal || '0')
  const protein = Number(source.protein || '0')
  const carbs = Number(source.carbs || '0')
  const fat = Number(source.fat || '0')

  if (!name) {
    return { values: null, error: 'Add an ingredient name.' } as const
  }

  if (!Number.isFinite(portionSize) || portionSize <= 0) {
    return { values: null, error: 'Portion size must be greater than 0.' } as const
  }

  if (!Number.isFinite(kcal) || kcal < 0) {
    return { values: null, error: 'Calories must be zero or a positive number.' } as const
  }

  if (![protein, carbs, fat].every(value => Number.isFinite(value) && value >= 0)) {
    return { values: null, error: 'Macros must be zero or a positive number.' } as const
  }

  return {
    values: { name, unit, portionSize, kcal, protein, carbs, fat },
    error: ''
  } as const
}

function resetIngredientDraft(target: IngredientFormState) {
  target.name = ''
  target.portionSize = ''
  target.unit = 'g'
  target.kcal = ''
  target.protein = ''
  target.carbs = ''
  target.fat = ''
}

function fillIngredientDraftFromValues(target: IngredientFormState, values: Partial<IngredientDraftValues>) {
  target.name = typeof values.name === 'string' ? values.name : ''
  target.unit = typeof values.unit === 'string' && values.unit.trim() ? values.unit : 'g'
  target.portionSize = typeof values.portionSize === 'number' && Number.isFinite(values.portionSize)
    ? String(roundToThree(values.portionSize))
    : ''
  target.kcal = typeof values.kcal === 'number' && Number.isFinite(values.kcal)
    ? String(Math.round(values.kcal))
    : ''
  target.protein = typeof values.protein === 'number' && Number.isFinite(values.protein)
    ? String(roundToOne(values.protein))
    : ''
  target.carbs = typeof values.carbs === 'number' && Number.isFinite(values.carbs)
    ? String(roundToOne(values.carbs))
    : ''
  target.fat = typeof values.fat === 'number' && Number.isFinite(values.fat)
    ? String(roundToOne(values.fat))
    : ''
}

function fillIngredientDraftFromIngredient(target: IngredientFormState, ingredient: IngredientEntry) {
  fillIngredientDraftFromValues(target, {
    name: ingredient.name,
    unit: ingredient.unit,
    portionSize: ingredient.portionSize,
    kcal: ingredient.kcal,
    protein: ingredient.protein,
    carbs: ingredient.carbs,
    fat: ingredient.fat
  })
}

function macroLabel(label: string, value: number, unit: string) {
  return `${label}: ${formatDensity(value)}g/${unit}`
}

function formatDensity(value: number) {
  const rounded = roundToSix(value)
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: rounded > 0 && rounded < 1 ? 4 : 2
  }).format(rounded)
}

function formatPortionSize(value: number) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 3
  }).format(value)
}

function roundToOne(value: number) {
  return Math.round(value * 10) / 10
}

function roundToThree(value: number) {
  return Math.round(value * 1000) / 1000
}

function roundToSix(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000
}

function createIngredientId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createIngredientEntry(
  values: IngredientDraftValues,
  existing?: Pick<IngredientEntry, 'id' | 'uuid' | 'createdAt'>
): IngredientEntry {
  return {
    id: existing?.id ?? createIngredientId(),
    uuid: existing?.uuid ?? createUuid(),
    name: values.name,
    unit: values.unit,
    portionSize: roundToThree(values.portionSize),
    kcal: Math.round(values.kcal),
    protein: roundToOne(values.protein),
    carbs: roundToOne(values.carbs),
    fat: roundToOne(values.fat),
    kcalPerUnit: roundToSix(values.kcal / values.portionSize),
    proteinPerUnit: roundToSix(values.protein / values.portionSize),
    carbsPerUnit: roundToSix(values.carbs / values.portionSize),
    fatPerUnit: roundToSix(values.fat / values.portionSize),
    createdAt: existing?.createdAt ?? new Date().toISOString()
  }
}

function normalizeJsonText(value: string) {
  let normalized = value.trim()
  const fencedMatch = normalized.match(/^```(?:[a-z]+)?\s*([\s\S]*?)\s*```$/i)

  if (fencedMatch && typeof fencedMatch[1] === 'string') {
    normalized = fencedMatch[1].trim()
  }

  const firstLine = normalized.split('\n')[0]?.trim()

  if (firstLine === 'ts' || firstLine === 'json') {
    normalized = normalized.split('\n').slice(1).join('\n').trim()
  }

  return normalized
}

async function loadIngredientsFromDb(): Promise<IngredientEntry[]> {
  try {
    const parsed = await readClientCollection<unknown>(INGREDIENTS_COLLECTION_KEY)
    return parsed.flatMap(normalizeIngredient)
  }
  catch (error) {
    console.error('Failed to read ingredients from IndexedDB', error)
    return []
  }
}

function normalizeIngredient(value: unknown): IngredientEntry[] {
  if (!value || typeof value !== 'object') {
    return []
  }

  const ingredient = value as Partial<IngredientEntry>

  if (typeof ingredient.id !== 'string' || typeof ingredient.name !== 'string' || typeof ingredient.createdAt !== 'string') {
    return []
  }

  if (typeof ingredient.kcal !== 'number' || !Number.isFinite(ingredient.kcal)) {
    return []
  }

  if (typeof ingredient.protein !== 'number' || !Number.isFinite(ingredient.protein)) {
    return []
  }

  if (typeof ingredient.carbs !== 'number' || !Number.isFinite(ingredient.carbs)) {
    return []
  }

  if (typeof ingredient.fat !== 'number' || !Number.isFinite(ingredient.fat)) {
    return []
  }

  if (ingredient.kcal < 0 || ingredient.protein < 0 || ingredient.carbs < 0 || ingredient.fat < 0) {
    return []
  }

  const unit = typeof ingredient.unit === 'string' && ingredient.unit.trim() ? ingredient.unit.trim() : 'serving'
  const portionSize = typeof ingredient.portionSize === 'number'
    && Number.isFinite(ingredient.portionSize)
    && ingredient.portionSize > 0
    ? ingredient.portionSize
    : 1
  const kcalPerUnit = typeof ingredient.kcalPerUnit === 'number'
    && Number.isFinite(ingredient.kcalPerUnit)
    && ingredient.kcalPerUnit >= 0
    ? ingredient.kcalPerUnit
    : ingredient.kcal / portionSize
  const proteinPerUnit = typeof ingredient.proteinPerUnit === 'number'
    && Number.isFinite(ingredient.proteinPerUnit)
    && ingredient.proteinPerUnit >= 0
    ? ingredient.proteinPerUnit
    : ingredient.protein / portionSize
  const carbsPerUnit = typeof ingredient.carbsPerUnit === 'number'
    && Number.isFinite(ingredient.carbsPerUnit)
    && ingredient.carbsPerUnit >= 0
    ? ingredient.carbsPerUnit
    : ingredient.carbs / portionSize
  const fatPerUnit = typeof ingredient.fatPerUnit === 'number'
    && Number.isFinite(ingredient.fatPerUnit)
    && ingredient.fatPerUnit >= 0
    ? ingredient.fatPerUnit
    : ingredient.fat / portionSize
  const uuid = typeof ingredient.uuid === 'string' && isUuid(ingredient.uuid)
    ? ingredient.uuid
    : createUuid()

  return [{
    id: ingredient.id,
    uuid,
    name: ingredient.name.trim(),
    unit,
    portionSize: roundToThree(portionSize),
    kcal: Math.round(ingredient.kcal),
    protein: roundToOne(ingredient.protein),
    carbs: roundToOne(ingredient.carbs),
    fat: roundToOne(ingredient.fat),
    kcalPerUnit: roundToSix(kcalPerUnit),
    proteinPerUnit: roundToSix(proteinPerUnit),
    carbsPerUnit: roundToSix(carbsPerUnit),
    fatPerUnit: roundToSix(fatPerUnit),
    createdAt: ingredient.createdAt
  }]
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function createUuid() {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  const bytes = new Uint8Array(16)

  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  }
  else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80

  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.onerror = () => {
      reject(reader.error ?? new Error('Could not read file.'))
    }

    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Could not read file.'))
        return
      }

      resolve(reader.result)
    }

    reader.readAsDataURL(file)
  })
}
</script>

<template>
  <div class="flex w-full max-w-5xl flex-col gap-6">
    <header class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-highlighted sm:text-3xl">
          Ingredients
        </h1>
        <p class="text-sm text-muted">
          Build a reusable ingredient reference (macros + calories) to make meal logging faster.
        </p>
      </div>

      <div class="flex items-center gap-2">
        <UButton
          type="button"
          color="neutral"
          variant="soft"
          size="sm"
          icon="i-lucide-camera"
          :disabled="!storageLoaded"
          @click="openAiImportIngredientFlow"
        >
          Scan Label
        </UButton>

        <UButton
          type="button"
          color="primary"
          variant="solid"
          size="sm"
          icon="i-lucide-plus"
          @click="openCreateIngredientModal()"
        >
          Add ingredient
        </UButton>
      </div>
    </header>

    <section>
      <UCard>
        <div class="space-y-4">
          <div class="flex items-center justify-between gap-4">
            <div>
              <h2 class="text-lg font-semibold text-highlighted">
                Ingredient list
              </h2>
              <p class="text-sm text-muted">
                {{ sortedIngredients.length }} ingredient{{ sortedIngredients.length === 1 ? '' : 's' }} saved
              </p>
            </div>

            <UBadge
              color="neutral"
              variant="soft"
            >
              IndexedDB
            </UBadge>
          </div>

          <div
            v-if="!storageLoaded"
            class="rounded-lg border border-dashed border-default px-4 py-8 text-center text-sm text-muted"
          >
            Loading ingredients...
          </div>

          <div
            v-else-if="sortedIngredients.length === 0"
            class="rounded-lg border border-dashed border-default px-4 py-8 text-center"
          >
            <p class="text-sm font-medium text-highlighted">
              No ingredients saved yet
            </p>
            <p class="mt-1 text-sm text-muted">
              Add ingredients with macros and calories so they are ready when you log meals.
            </p>
          </div>

          <ul
            v-else
            class="divide-y divide-default rounded-lg border border-default"
          >
            <li
              v-for="ingredient in sortedIngredients"
              :key="ingredient.id"
              class="flex flex-col gap-3 px-4 py-4"
            >
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="truncate text-sm font-semibold text-highlighted sm:text-base">
                    {{ ingredient.name }}
                  </p>
                  <p class="text-sm text-muted">
                    {{ ingredient.kcal.toLocaleString() }} kcal per {{ formatPortionSize(ingredient.portionSize) }} {{ ingredient.unit }}
                  </p>
                  <p class="text-xs text-muted">
                    {{ formatDensity(ingredient.kcalPerUnit) }} kcal/{{ ingredient.unit }}
                  </p>
                </div>

                <div class="flex items-center gap-1">
                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    @click="openEditIngredientModal(ingredient)"
                  >
                    Edit
                  </UButton>

                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    @click="removeIngredient(ingredient.id)"
                  >
                    Remove
                  </UButton>
                </div>
              </div>

              <div class="flex flex-wrap gap-2">
                <UBadge
                  color="neutral"
                  variant="soft"
                  :style="MACRO_COLORS.protein.badgeStyle"
                >
                  {{ macroLabel('P', ingredient.proteinPerUnit, ingredient.unit) }}
                </UBadge>
                <UBadge
                  color="neutral"
                  variant="soft"
                  :style="MACRO_COLORS.carbs.badgeStyle"
                >
                  {{ macroLabel('C', ingredient.carbsPerUnit, ingredient.unit) }}
                </UBadge>
                <UBadge
                  color="neutral"
                  variant="soft"
                  :style="MACRO_COLORS.fat.badgeStyle"
                >
                  {{ macroLabel('F', ingredient.fatPerUnit, ingredient.unit) }}
                </UBadge>
              </div>
            </li>
          </ul>
        </div>
      </UCard>
    </section>

    <UModal
      v-model:open="isImportIngredientModalOpen"
      title="Import ingredient from JSON"
      description="Paste a product payload. After parsing, the ingredient editor opens with the parsed fields prefilled so you can review them."
    >
      <template #body>
        <form
          class="space-y-4"
          @submit.prevent="parseImportIngredientJson"
        >
          <div class="space-y-2">
            <label
              for="import-ingredient-json"
              class="block text-sm font-medium text-highlighted"
            >
              JSON payload
            </label>
            <textarea
              id="import-ingredient-json"
              v-model="importIngredientJson"
              rows="12"
              spellcheck="false"
              placeholder="{&quot;product_name&quot;: ...}"
              class="w-full rounded-[calc(var(--ui-radius)*1px)] border border-default bg-default px-3 py-2.5 text-sm text-highlighted outline-none ring-0 transition focus:border-primary"
            />
          </div>

          <p
            v-if="importIngredientError"
            class="text-sm text-error"
          >
            {{ importIngredientError }}
          </p>

          <div class="flex flex-col-reverse items-end gap-2 sm:flex-row sm:justify-end">
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              @click="closeImportIngredientModal"
            >
              Cancel
            </UButton>

            <UButton
              type="submit"
              icon="i-lucide-file-json"
            >
              Parse and review
            </UButton>
          </div>
        </form>
      </template>
    </UModal>

    <IngredientEditorModal
      v-model:open="isIngredientEditorModalOpen"
      :mode="ingredientEditorMode"
      :form="ingredientEditorForm"
      :error="ingredientEditorError"
      @cancel="closeIngredientEditorModal"
      @submit="submitIngredientEditor"
    />

    <UModal
      v-model:open="isExportModalOpen"
      title="Export ingredients"
      description="Use this list to map ingredient names to UUIDs."
    >
      <template #body>
        <div class="space-y-4">
          <div
            v-if="!storageLoaded"
            class="rounded-lg border border-dashed border-default px-4 py-6 text-center text-sm text-muted"
          >
            Loading ingredients...
          </div>

          <div
            v-else-if="sortedIngredients.length === 0"
            class="rounded-lg border border-dashed border-default px-4 py-6 text-center"
          >
            <p class="text-sm font-medium text-highlighted">
              No ingredients to export
            </p>
            <p class="mt-1 text-sm text-muted">
              Add ingredients first, then reopen this export list.
            </p>
          </div>

          <div
            v-else
            class="space-y-2"
          >
            <div class="flex items-center justify-between gap-3">
              <p class="text-xs text-muted">
                {{ sortedIngredients.length }} item{{ sortedIngredients.length === 1 ? '' : 's' }}
              </p>

              <UButton
                type="button"
                size="sm"
                color="neutral"
                variant="soft"
                icon="i-lucide-copy"
                @click="copyIngredientExportJson"
              >
                Copy JSON
              </UButton>
            </div>

            <p
              v-if="exportCopyError"
              class="text-sm text-error"
            >
              {{ exportCopyError }}
            </p>

            <p
              v-else-if="exportCopyNotice"
              class="text-sm text-success"
            >
              {{ exportCopyNotice }}
            </p>

            <div class="max-h-[60vh] overflow-y-auto rounded-lg border border-default">
              <pre class="overflow-x-auto px-4 py-3 text-xs leading-5 text-muted"><code>{{ ingredientExportJson }}</code></pre>
            </div>
          </div>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="isAiUnlockModalOpen"
      title="Unlock AI integration"
      :description="`Enter your 4-digit encryption password to unlock your ${selectedAiProviderLabel} key for this session.`"
    >
      <template #body>
        <form
          class="space-y-4"
          @submit.prevent="submitAiUnlock"
        >
          <div class="space-y-2">
            <label
              for="ingredients-ai-unlock-pin"
              class="block text-sm font-medium text-highlighted"
            >
              Encryption password (4 digits)
            </label>
            <UInput
              id="ingredients-ai-unlock-pin"
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
              :disabled="isUnlockingAiIntegration"
              @click="closeAiUnlockModal"
            >
              Cancel
            </UButton>

            <UButton
              type="submit"
              icon="i-lucide-unlock"
              :loading="isUnlockingAiIntegration"
            >
              Unlock and continue
            </UButton>
          </div>
        </form>
      </template>
    </UModal>

    <UModal
      v-model:open="isAiKeyMissingModalOpen"
      :title="aiAvailabilityModalTitle"
      :description="aiAvailabilityModalDescription"
    >
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-muted">
            Go to <span class="font-medium text-highlighted">Settings → AI Integration</span> and run
            <span class="font-medium text-highlighted">Setup AI integration</span> to save and encrypt a
            <span class="font-medium text-highlighted">{{ selectedAiProviderLabel }}</span> API key.
          </p>

          <div class="flex flex-col-reverse items-end gap-2 sm:flex-row sm:justify-end">
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              @click="closeAiKeyMissingModal"
            >
              Cancel
            </UButton>

            <UButton
              to="/settings"
              icon="i-lucide-sliders-horizontal"
              @click="closeAiKeyMissingModal"
            >
              Open Settings
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="isAiImportIngredientModalOpen"
      title="Import Nutrition Label (AI)"
      :description="`Upload a nutrition facts image and ${selectedAiProviderLabel} will extract ingredient fields for review in the editor.`"
    >
      <template #body>
        <form
          class="space-y-4"
          @submit.prevent="analyzeNutritionLabelWithAi"
        >
          <div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
            <div class="space-y-2">
              <label
                for="ai-nutrition-label-image"
                class="block text-sm font-medium text-highlighted"
              >
                Nutrition facts image
              </label>
              <input
                id="ai-nutrition-label-image"
                type="file"
                accept="image/*"
                class="block w-full rounded-[calc(var(--ui-radius)*1px)] border border-default bg-default px-3 py-2 text-sm text-highlighted file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary"
                @change="handleAiNutritionImageChange"
              >
              <p
                v-if="aiNutritionImageFileName"
                class="text-xs text-muted"
              >
                Selected: {{ aiNutritionImageFileName }}
              </p>
            </div>

            <div class="space-y-2">
              <label class="block text-sm font-medium text-highlighted">
                Provider
              </label>
              <div class="flex h-10 items-center rounded-[calc(var(--ui-radius)*1px)] border border-default bg-muted/20 px-3 text-sm text-highlighted">
                {{ selectedAiProviderLabel }}
              </div>
            </div>
          </div>

          <div
            v-if="aiNutritionImageDataUrl"
            class="space-y-2"
          >
            <p class="text-sm font-medium text-highlighted">
              Preview
            </p>
            <div class="overflow-hidden rounded-lg border border-default bg-muted/20">
              <img
                :src="aiNutritionImageDataUrl"
                alt="Nutrition label preview"
                class="max-h-72 w-full object-contain"
              >
            </div>
          </div>

          <p class="text-xs text-muted">
            Privacy note: this sends the selected nutrition label image to {{ selectedAiProviderLabel }} for extraction.
            Your ingredient list and meal history are not sent in this flow.
          </p>

          <p
            v-if="aiIngredientImportError"
            class="text-sm text-error"
          >
            {{ aiIngredientImportError }}
          </p>

          <div class="flex flex-col-reverse items-end gap-2 sm:flex-row sm:justify-end">
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              :disabled="isAnalyzingIngredientImage"
              @click="closeAiImportIngredientModal"
            >
              Cancel
            </UButton>

            <UButton
              type="submit"
              icon="i-lucide-sparkles"
              :loading="isAnalyzingIngredientImage"
            >
              Analyze image
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
