<script setup lang="ts">
import { readClientCollection, writeClientCollection } from '../../utils/client-db'
import { generateAiMealImportPayload } from '../../utils/ai-meal-import'
import {
  getUnlockedAiIntegration,
  isAiIntegrationUnlocked,
  readAiIntegrationMetadata,
  unlockAiIntegration
} from '../../utils/client-ai-integration'
import { writeMealImportEditorDraft } from '../../utils/meal-import-editor-draft'
import { MACRO_COLORS } from '../../utils/nutrition-colors'
import {
  DEFAULT_AI_PROVIDER,
  DEFAULT_CARBS_GOAL,
  DEFAULT_DAILY_CALORIE_GOAL,
  DEFAULT_FAT_GOAL,
  DEFAULT_PROTEIN_GOAL,
  readAppSettings
} from '../../utils/client-settings'
import type { AiProvider, AppSettings } from '../../utils/client-settings'

type MealEntryMode = 'manual' | 'ingredients'

interface MealIngredientSnapshot {
  name: string
  amount: number
  unit: string
}

interface MealEntry {
  id: string
  name: string
  calories: number
  protein: number
  carbs: number
  fat: number
  ingredients: MealIngredientSnapshot[]
  createdAt: string
}

interface IngredientReference {
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

interface MealIngredientRow {
  id: string
  ingredientId: string
  quantity: string | number
}

type MealFormState = {
  name: string
  calories: string
  protein: string
  carbs: string
  fat: string
  entryMode: MealEntryMode
}

const MEALS_COLLECTION_KEY = 'meals'
const INGREDIENTS_COLLECTION_KEY = 'ingredients'

const meals = ref<MealEntry[]>([])
const ingredients = ref<IngredientReference[]>([])
const dailyCalorieGoal = ref(DEFAULT_DAILY_CALORIE_GOAL)
const proteinGoal = ref(DEFAULT_PROTEIN_GOAL)
const carbsGoal = ref(DEFAULT_CARBS_GOAL)
const fatGoal = ref(DEFAULT_FAT_GOAL)
const mealsLoaded = ref(false)
const ingredientsLoaded = ref(false)
const isAddMealOpen = ref(false)
const isImportMealModalOpen = ref(false)
const isAiImportMealModalOpen = ref(false)
const isAiKeyMissingModalOpen = ref(false)
const isAiUnlockModalOpen = ref(false)
const historyDaysAgo = ref(0)
const aiIntegration = ref<Awaited<ReturnType<typeof readAiIntegrationMetadata>>>(null)
const isAiIntegrationUnlockedForSession = ref(false)
const aiAvailabilityMode = ref<'missing' | 'locked'>('missing')
const formError = ref('')
const importMealJson = ref('')
const importMealName = ref('Imported meal')
const importMealError = ref('')
const aiImportMealName = ref('')
const aiImportDescription = ref('')
const aiImportError = ref('')
const isGeneratingAiImport = ref(false)
const aiUnlockPin = ref('')
const aiUnlockError = ref('')
const isUnlockingAiIntegration = ref(false)
const isConsumingComposeQuery = ref(false)
const form = reactive<MealFormState>({
  name: '',
  calories: '',
  protein: '',
  carbs: '',
  fat: '',
  entryMode: 'manual'
})
const mealIngredientRows = ref<MealIngredientRow[]>([createMealIngredientRow()])
const route = useRoute()

const selectedDate = computed(() => {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - historyDaysAgo.value)
  return date
})
const selectedDateKey = computed(() => toLocalDateKey(selectedDate.value))
const isViewingToday = computed(() => historyDaysAgo.value === 0)
const todayLabel = computed(() => new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric'
}).format(selectedDate.value))

const todayMeals = computed(() => {
  return meals.value
    .filter(meal => toLocalDateKey(new Date(meal.createdAt)) === selectedDateKey.value)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
})

const totalCaloriesToday = computed(() => {
  return todayMeals.value.reduce((total, meal) => total + meal.calories, 0)
})

const sortedIngredients = computed(() => {
  return [...ingredients.value].sort((a, b) => a.name.localeCompare(b.name))
})

const ingredientsById = computed(() => {
  return new Map(sortedIngredients.value.map(ingredient => [ingredient.id, ingredient]))
})

const ingredientSelectOptions = computed(() => {
  return sortedIngredients.value.map(ingredient => ({
    label: ingredientOptionLabel(ingredient),
    value: ingredient.id
  }))
})

const selectedAiProvider = computed<AiProvider>(() => {
  return aiIntegration.value?.provider ?? DEFAULT_AI_PROVIDER
})

const selectedAiProviderLabel = computed(() => {
  return providerLabel(selectedAiProvider.value)
})

const aiAvailabilityModalTitle = computed(() => {
  return aiAvailabilityMode.value === 'locked'
    ? 'Unlock AI integration'
    : 'AI integration required'
})

const aiAvailabilityModalDescription = computed(() => {
  return aiAvailabilityMode.value === 'locked'
    ? `Your ${selectedAiProviderLabel.value} key is configured but locked. Unlock it in Settings before using AI import.`
    : 'Set up an encrypted AI provider key in Settings before using AI import.'
})

const composedTotals = computed(() => {
  return mealIngredientRows.value.reduce((totals, row) => {
    const quantity = parseFlexibleDecimal(row.quantity)

    if (!row.ingredientId || quantity === null || quantity <= 0) {
      return totals
    }

    const ingredient = ingredientsById.value.get(row.ingredientId)

    if (!ingredient) {
      return totals
    }

    totals.calories += ingredient.kcalPerUnit * quantity
    totals.protein += ingredient.proteinPerUnit * quantity
    totals.carbs += ingredient.carbsPerUnit * quantity
    totals.fat += ingredient.fatPerUnit * quantity

    return totals
  }, {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0
  })
})

const hasIngredients = computed(() => ingredients.value.length > 0)
const isMealDataReady = computed(() => mealsLoaded.value && ingredientsLoaded.value)

onMounted(async () => {
  applySelectedDateFromQuery()

  const [loadedMeals, loadedIngredients, settings, aiMetadata] = await Promise.all([
    loadMealsFromDb(),
    loadIngredientsFromDb(),
    loadSettingsFromDb(),
    readAiIntegrationMetadata()
  ])

  meals.value = loadedMeals
  ingredients.value = loadedIngredients
  dailyCalorieGoal.value = settings.dailyCalorieGoal
  proteinGoal.value = settings.proteinGoal
  carbsGoal.value = settings.carbsGoal
  fatGoal.value = settings.fatGoal
  aiIntegration.value = aiMetadata
  isAiIntegrationUnlockedForSession.value = isAiIntegrationUnlocked()
  mealsLoaded.value = true
  ingredientsLoaded.value = true

  await consumeComposeQueryFromRoute()
})

watch(meals, (value) => {
  if (!mealsLoaded.value) {
    return
  }

  void persistMealsToDb(value)
}, { deep: true })

watch(ingredients, (value) => {
  if (!ingredientsLoaded.value) {
    return
  }

  void persistIngredientsToDb(value)
}, { deep: true })

watch(() => route.query.date, () => {
  applySelectedDateFromQuery()
})

watch(() => route.query.compose, () => {
  if (!isMealDataReady.value) {
    return
  }

  void consumeComposeQueryFromRoute()
})

watch(isMealDataReady, (ready) => {
  if (!ready) {
    return
  }

  void consumeComposeQueryFromRoute()
})

async function persistMealsToDb(value: MealEntry[]) {
  try {
    await writeClientCollection(MEALS_COLLECTION_KEY, value)
  } catch (error) {
    console.error('Failed to persist meals to IndexedDB', error)
  }
}

async function persistIngredientsToDb(value: IngredientReference[]) {
  try {
    await writeClientCollection(INGREDIENTS_COLLECTION_KEY, value)
  } catch (error) {
    console.error('Failed to persist imported ingredients to IndexedDB', error)
  }
}

function setEntryMode(mode: MealEntryMode) {
  form.entryMode = mode
  formError.value = ''

  if (mode === 'ingredients' && mealIngredientRows.value.length === 0) {
    mealIngredientRows.value = [createMealIngredientRow()]
  }
}

function addMeal() {
  formError.value = ''

  if (!isMealDataReady.value) {
    formError.value = 'Meals are still loading. Try again in a moment.'
    return
  }

  const name = form.name.trim()

  if (!name) {
    formError.value = 'Add a meal name.'
    return
  }

  let calories = 0
  let protein = 0
  let carbs = 0
  let fat = 0
  let ingredientSnapshots: MealIngredientSnapshot[] = []

  if (form.entryMode === 'manual') {
    const manualCalories = Number(form.calories)
    const manualProtein = Number(form.protein || '0')
    const manualCarbs = Number(form.carbs || '0')
    const manualFat = Number(form.fat || '0')

    if (!Number.isFinite(manualCalories) || manualCalories < 0) {
      formError.value = 'Calories must be zero or a positive number.'
      return
    }

    if (![manualProtein, manualCarbs, manualFat].every(value => Number.isFinite(value) && value >= 0)) {
      formError.value = 'Macros must be zero or a positive number.'
      return
    }

    calories = manualCalories
    protein = manualProtein
    carbs = manualCarbs
    fat = manualFat
  } else {
    if (!hasIngredients.value) {
      formError.value = 'Save at least one ingredient first.'
      return
    }

    let foundAtLeastOneRow = false
    let totalCalories = 0
    let totalProtein = 0
    let totalCarbs = 0
    let totalFat = 0
    const usedIngredients: MealIngredientSnapshot[] = []

    for (const row of mealIngredientRows.value) {
      const ingredientId = row.ingredientId.trim()
      const quantityInput = String(row.quantity ?? '').trim()
      const hasIngredientId = ingredientId.length > 0
      const hasQuantity = quantityInput.length > 0

      if (!hasIngredientId && !hasQuantity) {
        continue
      }

      foundAtLeastOneRow = true

      if (!hasIngredientId) {
        formError.value = 'Select an ingredient for each row you use.'
        return
      }

      const quantity = parseFlexibleDecimal(quantityInput)

      if (quantity === null || quantity <= 0) {
        formError.value = 'Ingredient quantity must be greater than 0.'
        return
      }

      const ingredient = ingredientsById.value.get(ingredientId)

      if (!ingredient) {
        formError.value = 'One selected ingredient could not be found. Try reselecting it.'
        return
      }

      totalCalories += ingredient.kcalPerUnit * quantity
      totalProtein += ingredient.proteinPerUnit * quantity
      totalCarbs += ingredient.carbsPerUnit * quantity
      totalFat += ingredient.fatPerUnit * quantity
      usedIngredients.push({
        name: ingredient.name,
        amount: roundToThree(quantity),
        unit: ingredient.unit
      })
    }

    if (!foundAtLeastOneRow) {
      formError.value = 'Add at least one ingredient row.'
      return
    }

    calories = totalCalories
    protein = totalProtein
    carbs = totalCarbs
    fat = totalFat
    ingredientSnapshots = usedIngredients
  }

  meals.value = [{
    id: createMealId(),
    name,
    calories: Math.round(calories),
    protein: roundToOne(protein),
    carbs: roundToOne(carbs),
    fat: roundToOne(fat),
    ingredients: ingredientSnapshots,
    createdAt: createMealCreatedAt()
  }, ...meals.value]

  cancelAddMeal()
}

function removeMeal(id: string) {
  meals.value = meals.value.filter(meal => meal.id !== id)
}

function goToPreviousDay() {
  historyDaysAgo.value += 1
}

function goToNextDay() {
  historyDaysAgo.value = Math.max(0, historyDaysAgo.value - 1)
}

function goToToday() {
  historyDaysAgo.value = 0
}

function addMealIngredientRow() {
  mealIngredientRows.value = [...mealIngredientRows.value, createMealIngredientRow()]
}

function removeMealIngredientRow(rowId: string) {
  if (mealIngredientRows.value.length <= 1) {
    resetMealIngredientRows()
    return
  }

  mealIngredientRows.value = mealIngredientRows.value.filter(row => row.id !== rowId)
}

function resetMealIngredientRows() {
  mealIngredientRows.value = [createMealIngredientRow()]
}

function resetMealForm() {
  formError.value = ''
  form.name = ''
  form.calories = ''
  form.protein = ''
  form.carbs = ''
  form.fat = ''
  resetMealIngredientRows()
}

function cancelAddMeal() {
  resetMealForm()
  isAddMealOpen.value = false
}

async function openAiImportMealFlow() {
  if (!isMealDataReady.value) {
    formError.value = 'Meals and ingredients are still loading. Try again in a moment.'
    return
  }

  formError.value = ''

  await refreshAiIntegrationAvailability()

  if (!aiIntegration.value) {
    aiAvailabilityMode.value = 'missing'
    aiImportError.value = ''
    isAiKeyMissingModalOpen.value = true
    return
  }

  if (!isAiIntegrationUnlockedForSession.value || !getUnlockedAiIntegration()) {
    openAiUnlockModal()
    return
  }

  openAiImportMealModal()
}

async function consumeComposeQueryFromRoute() {
  if (isConsumingComposeQuery.value) {
    return
  }

  const compose = typeof route.query.compose === 'string'
    ? route.query.compose.trim().toLowerCase()
    : ''

  if (compose !== 'ai') {
    return
  }

  isConsumingComposeQuery.value = true

  try {
    await openAiImportMealFlow()

    const nextQuery = { ...route.query }
    delete nextQuery.compose

    void navigateTo({
      path: '/meals',
      query: nextQuery
    }, { replace: true })
  } finally {
    isConsumingComposeQuery.value = false
  }
}

function openAiImportMealModal() {
  aiImportError.value = ''
  isAiImportMealModalOpen.value = true
}

function resetAiImportMealModal() {
  aiImportError.value = ''
  aiImportMealName.value = ''
  aiImportDescription.value = ''
}

function closeAiImportMealModal() {
  resetAiImportMealModal()
  isAiImportMealModalOpen.value = false
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
  aiUnlockError.value = ''
  aiUnlockPin.value = ''
  isAiUnlockModalOpen.value = false
}

async function submitAiUnlock() {
  aiUnlockError.value = ''

  const pin = aiUnlockPin.value.trim()

  if (pin.length === 0) {
    aiUnlockError.value = 'Enter your 4-digit encryption password.'
    return
  }

  isUnlockingAiIntegration.value = true

  try {
    aiIntegration.value = await unlockAiIntegration(pin)
    isAiIntegrationUnlockedForSession.value = true
    closeAiUnlockModal()
    openAiImportMealModal()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to unlock AI integration.'
    aiUnlockError.value = message
  } finally {
    isUnlockingAiIntegration.value = false
  }
}

function resetImportMealModal() {
  importMealError.value = ''
  importMealJson.value = ''
  importMealName.value = 'Imported meal'
}

function closeImportMealModal() {
  resetImportMealModal()
  isImportMealModalOpen.value = false
}

async function generateMealImportJsonWithAi() {
  aiImportError.value = ''

  if (!isMealDataReady.value) {
    aiImportError.value = 'Meals and ingredients are still loading. Try again in a moment.'
    return
  }

  const description = aiImportDescription.value.trim()
  const requestedMealName = aiImportMealName.value.trim()

  if (!description) {
    aiImportError.value = 'Describe the meal first.'
    return
  }

  await refreshAiIntegrationAvailability()
  const unlockedAiIntegration = getUnlockedAiIntegration()

  if (!unlockedAiIntegration || !unlockedAiIntegration.apiKey.trim()) {
    closeAiImportMealModal()
    if (aiIntegration.value) {
      openAiUnlockModal()
    } else {
      aiAvailabilityMode.value = 'missing'
      isAiKeyMissingModalOpen.value = true
    }
    return
  }

  isGeneratingAiImport.value = true

  try {
    const payload = await generateAiMealImportPayload({
      provider: unlockedAiIntegration.provider,
      apiKey: unlockedAiIntegration.apiKey.trim(),
      mealName: requestedMealName || undefined,
      mealDescription: description,
      ingredients: sortedIngredients.value
        .filter(ingredient => ingredient.uuid.trim().length > 0)
        .map(ingredient => ({
          ingredient_id: ingredient.uuid,
          name: ingredient.name,
          unit: ingredient.unit,
          kcal_per_unit: roundToSix(ingredient.kcalPerUnit),
          protein_per_unit_g: roundToSix(ingredient.proteinPerUnit),
          carbs_per_unit_g: roundToSix(ingredient.carbsPerUnit),
          fat_per_unit_g: roundToSix(ingredient.fatPerUnit)
        }))
    })

    openMealImportEditorFromJson({
      mealName: requestedMealName || payload.meal_name?.trim() || 'AI meal',
      json: JSON.stringify(payload, null, 2),
      source: 'ai'
    })
    closeAiImportMealModal()
  } catch (error) {
    console.error('Failed to generate meal JSON with AI', error)
    const message = error instanceof Error ? error.message : 'Unknown error'

    if (/failed to fetch/i.test(message)) {
      aiImportError.value = 'Network request failed. This may be blocked by browser/provider CORS. Try again or use manual JSON import.'
      return
    }

    aiImportError.value = message
  } finally {
    isGeneratingAiImport.value = false
  }
}

async function refreshAiIntegrationAvailability() {
  try {
    aiIntegration.value = await readAiIntegrationMetadata()
  } catch (error) {
    console.error('Failed to read AI integration metadata from IndexedDB', error)
    aiIntegration.value = null
  }

  isAiIntegrationUnlockedForSession.value = isAiIntegrationUnlocked()
}

function importMealFromJson() {
  importMealError.value = ''

  if (!isMealDataReady.value) {
    importMealError.value = 'Meals and ingredients are still loading. Try again in a moment.'
    return
  }

  const jsonInput = importMealJson.value.trim()

  if (!jsonInput) {
    importMealError.value = 'Paste the JSON payload first.'
    return
  }

  openMealImportEditorFromJson({
    mealName: importMealName.value.trim() || 'Imported meal',
    json: jsonInput,
    source: 'manual'
  })

  closeImportMealModal()
}

function openMealImportEditorFromJson(input: {
  mealName: string
  json: string
  source: 'ai' | 'manual'
}) {
  writeMealImportEditorDraft({
    mealName: input.mealName,
    json: input.json,
    source: input.source,
    targetDateKey: selectedDateKey.value
  })

  void navigateTo({
    path: '/meals/import',
    query: {
      date: selectedDateKey.value
    }
  })
}

function openExistingMealEditor(mealId: string) {
  void navigateTo({
    path: `/meals/${mealId}`,
    query: {
      date: selectedDateKey.value
    }
  })
}

function createMealIngredientRow(): MealIngredientRow {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ingredientId: '',
    quantity: '1'
  }
}

function ingredientOptionLabel(ingredient: IngredientReference) {
  return `${ingredient.name} (${formatDensity(ingredient.kcalPerUnit)} kcal/${ingredient.unit})`
}

function quantityLabelForRow(row: MealIngredientRow) {
  const ingredient = row.ingredientId ? ingredientsById.value.get(row.ingredientId) : null
  return ingredient ? `Qty (${ingredient.unit})` : 'Qty'
}

function mealTimeLabel(dateIso: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(dateIso))
}

function createMealCreatedAt() {
  if (isViewingToday.value) {
    return new Date().toISOString()
  }

  const now = new Date()
  const date = new Date(selectedDate.value)
  date.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds())
  return date.toISOString()
}

function formatMacro(value: number) {
  const rounded = roundToOne(value)
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function formatDensity(value: number) {
  const rounded = roundToSix(value)
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: rounded > 0 && rounded < 1 ? 4 : 2
  }).format(rounded)
}

function formatAmount(value: number) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 3
  }).format(roundToThree(value))
}

function parseFlexibleDecimal(value: string | number) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  const normalized = value.trim().replace(/,/g, '.')

  if (!normalized) {
    return null
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
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

function toLocalDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function applySelectedDateFromQuery() {
  const queryDate = typeof route.query.date === 'string' ? route.query.date : ''

  if (!/^\d{4}-\d{2}-\d{2}$/.test(queryDate)) {
    return
  }

  const parsed = new Date(`${queryDate}T00:00:00`)

  if (Number.isNaN(parsed.getTime())) {
    return
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  parsed.setHours(0, 0, 0, 0)

  const diffMs = today.getTime() - parsed.getTime()
  const diffDays = Math.round(diffMs / 86_400_000)

  if (diffDays >= 0) {
    historyDaysAgo.value = diffDays
  }
}

function createMealId() {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function loadMealsFromDb(): Promise<MealEntry[]> {
  try {
    const parsed = await readClientCollection<unknown>(MEALS_COLLECTION_KEY)
    return parsed.flatMap(normalizeMeal)
  } catch (error) {
    console.error('Failed to read meals from IndexedDB', error)
    return []
  }
}

function normalizeMeal(value: unknown): MealEntry[] {
  if (!value || typeof value !== 'object') {
    return []
  }

  const meal = value as Partial<MealEntry>

  if (typeof meal.id !== 'string' || typeof meal.name !== 'string' || typeof meal.createdAt !== 'string') {
    return []
  }

  if (typeof meal.calories !== 'number' || !Number.isFinite(meal.calories) || meal.calories < 0) {
    return []
  }

  const protein = typeof meal.protein === 'number' && Number.isFinite(meal.protein) && meal.protein >= 0 ? meal.protein : 0
  const carbs = typeof meal.carbs === 'number' && Number.isFinite(meal.carbs) && meal.carbs >= 0 ? meal.carbs : 0
  const fat = typeof meal.fat === 'number' && Number.isFinite(meal.fat) && meal.fat >= 0 ? meal.fat : 0
  const ingredients = Array.isArray(meal.ingredients)
    ? meal.ingredients.flatMap(normalizeMealIngredientSnapshot)
    : []

  return [{
    id: meal.id,
    name: meal.name.trim(),
    calories: Math.round(meal.calories),
    protein: roundToOne(protein),
    carbs: roundToOne(carbs),
    fat: roundToOne(fat),
    ingredients,
    createdAt: meal.createdAt
  }]
}

function normalizeMealIngredientSnapshot(value: unknown): MealIngredientSnapshot[] {
  if (!value || typeof value !== 'object') {
    return []
  }

  const item = value as Partial<MealIngredientSnapshot>

  if (typeof item.name !== 'string' || typeof item.unit !== 'string') {
    return []
  }

  if (typeof item.amount !== 'number' || !Number.isFinite(item.amount) || item.amount <= 0) {
    return []
  }

  const name = item.name.trim()
  const unit = item.unit.trim()

  if (!name || !unit) {
    return []
  }

  return [{
    name,
    amount: roundToThree(item.amount),
    unit
  }]
}

async function loadIngredientsFromDb(): Promise<IngredientReference[]> {
  try {
    const parsed = await readClientCollection<unknown>(INGREDIENTS_COLLECTION_KEY)
    return parsed.flatMap(normalizeIngredient)
  } catch (error) {
    console.error('Failed to read ingredients from IndexedDB', error)
    return []
  }
}

async function loadSettingsFromDb(): Promise<AppSettings> {
  try {
    return await readAppSettings()
  } catch (error) {
    console.error('Failed to read settings from IndexedDB', error)
    return {
      dailyCalorieGoal: DEFAULT_DAILY_CALORIE_GOAL,
      proteinGoal: DEFAULT_PROTEIN_GOAL,
      carbsGoal: DEFAULT_CARBS_GOAL,
      fatGoal: DEFAULT_FAT_GOAL
    }
  }
}

function providerLabel(provider: AiProvider) {
  return provider === 'openai' ? 'OpenAI' : 'Anthropic'
}

function normalizeIngredient(value: unknown): IngredientReference[] {
  if (!value || typeof value !== 'object') {
    return []
  }

  const ingredient = value as Partial<IngredientReference>

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
  const uuid = typeof ingredient.uuid === 'string' ? ingredient.uuid.trim() : ''

  return [{
    id: ingredient.id,
    uuid,
    name: ingredient.name.trim(),
    unit,
    portionSize,
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
</script>

<template>
  <div class="flex w-full max-w-5xl flex-col gap-6">
    <header class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-highlighted sm:text-3xl">
          Meals
        </h1>
        <p class="text-sm text-muted">
          Log meals and browse previous days. Stored only in this browser (IndexedDB).
        </p>
      </div>

      <div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
        <UButton
          type="button"
          color="neutral"
          variant="soft"
          size="sm"
          icon="i-lucide-sparkles"
          :disabled="!isMealDataReady"
          class="w-full justify-center sm:w-auto"
          @click="openAiImportMealFlow"
        >
          Log with AI
        </UButton>

        <UButton
          type="button"
          color="primary"
          variant="solid"
          size="sm"
          :disabled="!isMealDataReady"
          icon="i-lucide-plus"
          class="w-full justify-center sm:w-auto"
          @click="navigateTo({ path: '/meals/new', query: { date: selectedDateKey } })"
        >
          {{ !isMealDataReady ? 'Loading...' : 'Log meal' }}
        </UButton>
      </div>
    </header>

    <section class="grid gap-6">
      <UCard
        v-if="isAddMealOpen"
        id="add-meal-card"
      >
        <div class="space-y-4">
          <div>
            <h2 class="text-lg font-semibold text-highlighted">
              Add meal
            </h2>
            <p class="text-sm text-muted">
              Log a meal manually or build it from saved ingredients.
            </p>
          </div>

          <form
            class="space-y-4"
            @submit.prevent="addMeal"
          >
            <div class="space-y-2">
              <label
                for="meal-name"
                class="block text-sm font-medium text-highlighted"
              >
                Meal name
              </label>
              <UInput
                id="meal-name"
                v-model="form.name"
                placeholder="e.g. Greek yogurt bowl"
                size="lg"
              />
            </div>

            <div class="space-y-2">
              <p class="text-sm font-medium text-highlighted">
                Input method
              </p>
              <div class="grid grid-cols-2 gap-2 rounded-xl border border-default bg-muted/20 p-1">
                <button
                  type="button"
                  class="rounded-lg px-3 py-2 text-sm font-medium transition"
                  :class="form.entryMode === 'manual'
                    ? 'bg-primary text-inverted shadow-sm'
                    : 'text-muted hover:bg-muted/40 hover:text-highlighted'"
                  @click="setEntryMode('manual')"
                >
                  Manual
                </button>
                <button
                  type="button"
                  class="rounded-lg px-3 py-2 text-sm font-medium transition"
                  :class="form.entryMode === 'ingredients'
                    ? 'bg-primary text-inverted shadow-sm'
                    : 'text-muted hover:bg-muted/40 hover:text-highlighted'"
                  @click="setEntryMode('ingredients')"
                >
                  From ingredients
                </button>
              </div>
            </div>

            <div
              v-if="form.entryMode === 'manual'"
              class="space-y-3"
            >
              <div class="space-y-2">
                <label
                  for="meal-calories"
                  class="block text-sm font-medium text-highlighted"
                >
                  Calories
                </label>
                <UInput
                  id="meal-calories"
                  v-model="form.calories"
                  type="number"
                  min="0"
                  step="1"
                  inputmode="numeric"
                  placeholder="450"
                  size="lg"
                />
              </div>

              <div class="grid gap-3 sm:grid-cols-3">
                <div class="space-y-2">
                  <label
                    for="meal-protein"
                    class="block text-xs font-medium text-muted"
                  >
                    Protein (g)
                  </label>
                  <UInput
                    id="meal-protein"
                    v-model="form.protein"
                    type="number"
                    min="0"
                    step="0.1"
                    inputmode="decimal"
                    placeholder="0"
                  />
                </div>

                <div class="space-y-2">
                  <label
                    for="meal-carbs"
                    class="block text-xs font-medium text-muted"
                  >
                    Carbs (g)
                  </label>
                  <UInput
                    id="meal-carbs"
                    v-model="form.carbs"
                    type="number"
                    min="0"
                    step="0.1"
                    inputmode="decimal"
                    placeholder="0"
                  />
                </div>

                <div class="space-y-2">
                  <label
                    for="meal-fat"
                    class="block text-xs font-medium text-muted"
                  >
                    Fat (g)
                  </label>
                  <UInput
                    id="meal-fat"
                    v-model="form.fat"
                    type="number"
                    min="0"
                    step="0.1"
                    inputmode="decimal"
                    placeholder="0"
                  />
                </div>
              </div>

              <p class="text-xs text-muted">
                Use manual mode when you already know the totals. Macro fields are optional and default to 0.
              </p>
            </div>

            <div
              v-else
              class="space-y-3 rounded-xl border border-default bg-muted/15 p-3"
            >
              <div class="flex items-center justify-between gap-3">
                <div>
                  <p class="text-sm font-medium text-highlighted">
                    Compose from ingredients
                  </p>
                  <p class="text-xs text-muted">
                    Uses per-unit values saved in the Ingredients tab (for example kcal per g).
                  </p>
                </div>

                <UButton
                  type="button"
                  size="sm"
                  color="neutral"
                  variant="soft"
                  :disabled="!hasIngredients"
                  @click="addMealIngredientRow"
                >
                  Add row
                </UButton>
              </div>

              <div
                v-if="!ingredientsLoaded"
                class="rounded-lg border border-dashed border-default px-3 py-4 text-sm text-muted"
              >
                Loading ingredients...
              </div>

              <div
                v-else-if="!hasIngredients"
                class="rounded-lg border border-dashed border-default px-3 py-4"
              >
                <p class="text-sm font-medium text-highlighted">
                  No ingredients saved yet
                </p>
                <p class="mt-1 text-sm text-muted">
                  Add ingredients first, then come back to compose meals from them.
                </p>
                <UButton
                  to="/ingredients"
                  size="sm"
                  color="neutral"
                  variant="soft"
                  class="mt-3"
                >
                  Open Ingredients
                </UButton>
              </div>

              <div
                v-else
                class="space-y-3"
              >
                <div
                  v-for="(row, index) in mealIngredientRows"
                  :key="row.id"
                  class="rounded-lg border border-default bg-default px-3 py-3"
                >
                  <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px_auto] sm:items-end">
                    <div class="space-y-2">
                      <label
                        class="block text-xs font-medium text-muted"
                        :for="`meal-ingredient-${row.id}`"
                      >
                        Ingredient {{ index + 1 }}
                      </label>
                      <USelect
                        :id="`meal-ingredient-${row.id}`"
                        v-model="row.ingredientId"
                        :items="ingredientSelectOptions"
                        placeholder="Select ingredient"
                        class="w-full"
                      />
                    </div>

                    <div class="space-y-2">
                      <label
                        class="block text-xs font-medium text-muted"
                        :for="`meal-ingredient-qty-${row.id}`"
                      >
                        {{ quantityLabelForRow(row) }}
                      </label>
                      <QuantityInput
                        :id="`meal-ingredient-qty-${row.id}`"
                        v-model="row.quantity"
                        :min="0"
                        :step="1"
                        placeholder="1"
                      />
                    </div>

                    <UButton
                      type="button"
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      class="w-full justify-center sm:mb-0.5 sm:w-auto"
                      @click="removeMealIngredientRow(row.id)"
                    >
                      Remove
                    </UButton>
                  </div>
                </div>

                <div class="rounded-lg border border-default bg-primary/5 px-3 py-3">
                  <div class="flex items-center justify-between gap-3">
                    <p class="text-sm font-medium text-highlighted">
                      Composed total
                    </p>
                    <p class="text-sm font-semibold tabular-nums text-highlighted">
                      {{ Math.round(composedTotals.calories).toLocaleString() }} kcal
                    </p>
                  </div>

                  <div class="mt-2 flex flex-wrap gap-2">
                    <UBadge
                      color="neutral"
                      variant="soft"
                      :style="MACRO_COLORS.protein.badgeStyle"
                    >
                      P: {{ formatMacro(composedTotals.protein) }}g
                    </UBadge>
                    <UBadge
                      color="neutral"
                      variant="soft"
                      :style="MACRO_COLORS.carbs.badgeStyle"
                    >
                      C: {{ formatMacro(composedTotals.carbs) }}g
                    </UBadge>
                    <UBadge
                      color="neutral"
                      variant="soft"
                      :style="MACRO_COLORS.fat.badgeStyle"
                    >
                      F: {{ formatMacro(composedTotals.fat) }}g
                    </UBadge>
                  </div>
                </div>
              </div>
            </div>

            <p
              v-if="formError"
              class="text-sm text-error"
            >
              {{ formError }}
            </p>

            <div class="flex flex-col-reverse items-end gap-2 sm:flex-row sm:justify-end">
              <UButton
                type="button"
                color="neutral"
                variant="ghost"
                size="lg"
                class="justify-center"
                @click="cancelAddMeal"
              >
                Cancel
              </UButton>

              <UButton
                type="submit"
                size="lg"
                class="justify-center"
              >
                Add meal
              </UButton>
            </div>
          </form>
        </div>
      </UCard>
    </section>

    <UCard>
      <div class="space-y-4">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 class="text-lg font-semibold text-highlighted">
              Meal log
            </h2>
            <p class="text-sm text-muted">
              {{ todayMeals.length }} meal{{ todayMeals.length === 1 ? '' : 's' }} on {{ todayLabel }}
            </p>
          </div>

          <div class="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <UButton
              type="button"
              size="sm"
              color="neutral"
              variant="soft"
              icon="i-lucide-chevron-left"
              @click="goToPreviousDay"
            >
              Previous
            </UButton>

            <UButton
              type="button"
              size="sm"
              color="neutral"
              variant="ghost"
              :disabled="isViewingToday"
              @click="goToToday"
            >
              Today
            </UButton>

            <UButton
              type="button"
              size="sm"
              color="neutral"
              variant="soft"
              icon="i-lucide-chevron-right"
              trailing
              :disabled="isViewingToday"
              @click="goToNextDay"
            >
              Next
            </UButton>

            <UBadge
              color="neutral"
              variant="subtle"
              class="order-last sm:order-none"
            >
              {{ todayLabel }}
            </UBadge>

            <UBadge
              color="neutral"
              variant="soft"
            >
              {{ totalCaloriesToday.toLocaleString() }} kcal
            </UBadge>
          </div>
        </div>

        <div
          v-if="!mealsLoaded"
          class="rounded-lg border border-dashed border-default px-4 py-8 text-center text-sm text-muted"
        >
          Loading meals...
        </div>

        <div
          v-else-if="todayMeals.length === 0"
          class="rounded-lg border border-dashed border-default px-4 py-8 text-center"
        >
          <p class="text-sm font-medium text-highlighted">
            No meals logged for {{ todayLabel }}
          </p>
          <p class="mt-1 text-sm text-muted">
            {{ isViewingToday ? "Add your first meal to start tracking today's calories." : 'Use the day controls above to browse other dates, or add a meal for this date.' }}
          </p>
        </div>

        <ul
          v-else
          class="divide-y divide-default rounded-lg border border-default"
        >
          <li
            v-for="meal in todayMeals"
            :key="meal.id"
            class="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="min-w-0 space-y-1">
              <button
                type="button"
                class="truncate text-left text-sm font-semibold text-highlighted transition hover:text-primary sm:text-base"
                @click="openExistingMealEditor(meal.id)"
              >
                {{ meal.name }}
              </button>

              <p class="text-sm text-muted">
                Logged at {{ mealTimeLabel(meal.createdAt) }}
              </p>

              <div class="flex flex-wrap gap-2">
                <UBadge
                  color="neutral"
                  variant="soft"
                  size="sm"
                  :style="MACRO_COLORS.protein.badgeStyle"
                >
                  P: {{ formatMacro(meal.protein) }}g
                </UBadge>
                <UBadge
                  color="neutral"
                  variant="soft"
                  size="sm"
                  :style="MACRO_COLORS.carbs.badgeStyle"
                >
                  C: {{ formatMacro(meal.carbs) }}g
                </UBadge>
                <UBadge
                  color="neutral"
                  variant="soft"
                  size="sm"
                  :style="MACRO_COLORS.fat.badgeStyle"
                >
                  F: {{ formatMacro(meal.fat) }}g
                </UBadge>
              </div>

              <div
                v-if="meal.ingredients.length > 0"
                class="flex flex-wrap gap-2 pt-1"
              >
                <UBadge
                  v-for="(item, index) in meal.ingredients"
                  :key="`${meal.id}-ingredient-${index}`"
                  color="neutral"
                  variant="outline"
                  size="sm"
                >
                  {{ item.name }}: {{ formatAmount(item.amount) }} {{ item.unit }}
                </UBadge>
              </div>
            </div>

            <div class="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end sm:gap-3">
              <p class="mr-auto text-sm font-semibold tabular-nums text-highlighted sm:mr-0 sm:text-base">
                {{ meal.calories.toLocaleString() }} kcal
              </p>
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                class="flex-1 justify-center sm:flex-none"
                @click="openExistingMealEditor(meal.id)"
              >
                Edit
              </UButton>
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                class="flex-1 justify-center sm:flex-none"
                @click="removeMeal(meal.id)"
              >
                Remove
              </UButton>
            </div>
          </li>
        </ul>
      </div>
    </UCard>

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
              for="meals-ai-unlock-pin"
              class="block text-sm font-medium text-highlighted"
            >
              Encryption password (4 digits)
            </label>
            <UInput
              id="meals-ai-unlock-pin"
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
            <template v-if="aiAvailabilityMode === 'missing'">
              Go to <span class="font-medium text-highlighted">Settings → AI Integration</span> and run
              <span class="font-medium text-highlighted">Setup AI integration</span> to save and encrypt a
              <span class="font-medium text-highlighted">{{ selectedAiProviderLabel }}</span> API key.
            </template>
            <template v-else>
              Go to <span class="font-medium text-highlighted">Settings → AI Integration</span> and unlock your
              <span class="font-medium text-highlighted">{{ selectedAiProviderLabel }}</span> key with your encryption password.
            </template>
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
      v-model:open="isAiImportMealModalOpen"
      title="AI import meal"
      :description="`Describe a meal and ${selectedAiProviderLabel} will generate the import JSON using your saved ingredients list.`"
    >
      <template #body>
        <form
          class="space-y-4"
          @submit.prevent="generateMealImportJsonWithAi"
        >
          <div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
            <div class="space-y-2">
              <label
                for="ai-import-meal-name"
                class="block text-sm font-medium text-highlighted"
              >
                Meal name (optional)
              </label>
              <UInput
                id="ai-import-meal-name"
                v-model="aiImportMealName"
                placeholder="e.g. Ham sandwich"
              />
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

          <div class="space-y-2">
            <label
              for="ai-import-description"
              class="block text-sm font-medium text-highlighted"
            >
              Meal description
            </label>
            <UTextarea
              id="ai-import-description"
              v-model="aiImportDescription"
              :rows="6"
              spellcheck="false"
              placeholder="e.g. 2 slices of bread, 2 eggs, 1.5 slices ham, mayo"
              class="w-full"
            />
          </div>

          <p class="text-xs text-muted">
            Privacy note: this sends your meal description (and optional meal name) plus your current ingredient list
            (UUIDs, names, units, and per-unit nutrition) to {{ selectedAiProviderLabel }} to generate the import
            payload. Your meal history is not sent unless you type it into the description.
          </p>

          <p
            v-if="aiImportError"
            class="text-sm text-error"
          >
            {{ aiImportError }}
          </p>

          <div class="flex flex-col-reverse items-end gap-2 sm:flex-row sm:justify-end">
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              :disabled="isGeneratingAiImport"
              @click="closeAiImportMealModal"
            >
              Cancel
            </UButton>

            <UButton
              type="submit"
              icon="i-lucide-sparkles"
              :loading="isGeneratingAiImport"
            >
              Import
            </UButton>
          </div>
        </form>
      </template>
    </UModal>

    <UModal
      v-model:open="isImportMealModalOpen"
      title="Import meal from JSON"
      description="Paste a matched_ingredients payload (optionally with new_ingredients). Ingredient IDs are matched against ingredient UUIDs."
    >
      <template #body>
        <form
          class="space-y-4"
          @submit.prevent="importMealFromJson"
        >
          <div class="space-y-2">
            <label
              for="import-meal-name"
              class="block text-sm font-medium text-highlighted"
            >
              Meal name
            </label>
            <UInput
              id="import-meal-name"
              v-model="importMealName"
              placeholder="Imported meal"
            />
          </div>

          <div class="space-y-2">
            <label
              for="import-meal-json"
              class="block text-sm font-medium text-highlighted"
            >
              JSON payload
            </label>
            <UTextarea
              id="import-meal-json"
              v-model="importMealJson"
              :rows="12"
              spellcheck="false"
              placeholder="{&quot;matched_ingredients&quot;:[...]}"
              class="w-full"
            />
          </div>

          <p
            v-if="importMealError"
            class="text-sm text-error"
          >
            {{ importMealError }}
          </p>

          <div class="flex flex-col-reverse items-end gap-2 sm:flex-row sm:justify-end">
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              @click="closeImportMealModal"
            >
              Cancel
            </UButton>

            <UButton
              type="submit"
              icon="i-lucide-clipboard-paste"
            >
              Create meal
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
