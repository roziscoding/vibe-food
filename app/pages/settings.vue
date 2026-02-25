<script setup lang="ts">
import { testAiProviderKey } from '../utils/ai-meal-import'
import {
  changeAiIntegrationPassword,
  clearAiIntegration,
  getUnlockedAiIntegration,
  isAiIntegrationUnlocked as getIsAiIntegrationUnlocked,
  isValidAiPin,
  lockAiIntegration,
  readAiIntegrationMetadata,
  replaceAiIntegration,
  setupAiIntegration,
  unlockAiIntegration
} from '../utils/client-ai-integration'
import type { AiIntegrationMetadata } from '../utils/client-ai-integration'
import { clearClientData, readClientCollection, writeClientCollection } from '../utils/client-db'
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

type GoalSettings = Pick<AppSettings, 'dailyCalorieGoal' | 'proteinGoal' | 'carbsGoal' | 'fatGoal'>

type RecommendationSex = 'female' | 'male'
type RecommendationObjective = 'loss' | 'maintenance' | 'gain' | 'muscle'
type RecommendationActivity = 'sedentary' | 'low-active' | 'active' | 'very-active'

interface ExampleMealIngredientSnapshot {
  name: string
  amount: number
  unit: string
}

interface ExampleIngredientRecord {
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

interface ExampleMealRecord {
  id: string
  name: string
  calories: number
  protein: number
  carbs: number
  fat: number
  ingredients: ExampleMealIngredientSnapshot[]
  createdAt: string
}

type ExampleIngredientSeed = {
  slug: string
  uuid: string
  name: string
  unit: string
  portionSize: number
  kcal: number
  protein: number
  carbs: number
  fat: number
}

type ExampleMealSeed = {
  slug: string
  name: string
  hour: number
  minute: number
  items: Array<{
    ingredientUuid: string
    amount: number
  }>
}

const MEALS_COLLECTION_KEY = 'meals'
const INGREDIENTS_COLLECTION_KEY = 'ingredients'
const EXAMPLE_INGREDIENT_ID_PREFIX = 'example-ingredient-'
const EXAMPLE_MEAL_ID_PREFIX = 'example-meal-'

const EXAMPLE_INGREDIENT_SEEDS: ExampleIngredientSeed[] = [
  { slug: 'bread', uuid: '9be69650-2300-48c0-b2dc-26cc2258a372', name: 'Bread', unit: 'slice', portionSize: 1, kcal: 80, protein: 3, carbs: 14, fat: 1 },
  { slug: 'eggs', uuid: 'b478eccf-58de-4c75-9d0f-4cdac2839cae', name: 'Eggs', unit: 'egg', portionSize: 1, kcal: 72, protein: 6.3, carbs: 0.4, fat: 4.8 },
  { slug: 'mayonnaise', uuid: 'c67dade5-c61a-4097-b940-16ff446ccc89', name: 'Mayonnaise', unit: 'tbsp', portionSize: 1, kcal: 94, protein: 0.1, carbs: 0.1, fat: 10.3 },
  { slug: 'cheese-slices', uuid: 'a1de2e25-7b09-4f5f-bfd6-362b7d846e81', name: 'Cheese slices', unit: 'slice', portionSize: 1, kcal: 60, protein: 4, carbs: 1, fat: 5 },
  { slug: 'ham-slices', uuid: 'f18f2f2e-e777-4629-b3d0-3f7a3ea61455', name: 'Ham slices', unit: 'slice', portionSize: 1, kcal: 30, protein: 5, carbs: 1, fat: 1.5 },
  { slug: 'greek-yogurt', uuid: '34abf9fa-137b-41cc-bd8d-0817dd6f8440', name: 'Greek yogurt', unit: 'g', portionSize: 100, kcal: 59, protein: 10, carbs: 3.6, fat: 0.4 },
  { slug: 'oats', uuid: '9f450852-f642-4a03-b84a-3e7a95f88857', name: 'Oats', unit: 'g', portionSize: 100, kcal: 389, protein: 16.9, carbs: 66.3, fat: 6.9 },
  { slug: 'banana', uuid: 'f9fe96a4-fb89-4476-a41d-e598f613e2a0', name: 'Banana', unit: 'g', portionSize: 100, kcal: 89, protein: 1.1, carbs: 22.8, fat: 0.3 }
]

const EXAMPLE_MEAL_SEEDS: ExampleMealSeed[] = [
  {
    slug: 'egg-sandwich',
    name: 'Egg sandwich',
    hour: 8,
    minute: 15,
    items: [
      { ingredientUuid: '9be69650-2300-48c0-b2dc-26cc2258a372', amount: 2 },
      { ingredientUuid: 'b478eccf-58de-4c75-9d0f-4cdac2839cae', amount: 2 },
      { ingredientUuid: 'a1de2e25-7b09-4f5f-bfd6-362b7d846e81', amount: 1 },
      { ingredientUuid: 'c67dade5-c61a-4097-b940-16ff446ccc89', amount: 0.5 }
    ]
  },
  {
    slug: 'ham-cheese-sandwich',
    name: 'Ham & cheese sandwich',
    hour: 13,
    minute: 10,
    items: [
      { ingredientUuid: '9be69650-2300-48c0-b2dc-26cc2258a372', amount: 2 },
      { ingredientUuid: 'f18f2f2e-e777-4629-b3d0-3f7a3ea61455', amount: 3 },
      { ingredientUuid: 'a1de2e25-7b09-4f5f-bfd6-362b7d846e81', amount: 1 },
      { ingredientUuid: 'c67dade5-c61a-4097-b940-16ff446ccc89', amount: 1 }
    ]
  },
  {
    slug: 'yogurt-oats-bowl',
    name: 'Yogurt oats bowl',
    hour: 19,
    minute: 5,
    items: [
      { ingredientUuid: '34abf9fa-137b-41cc-bd8d-0817dd6f8440', amount: 220 },
      { ingredientUuid: '9f450852-f642-4a03-b84a-3e7a95f88857', amount: 55 },
      { ingredientUuid: 'f9fe96a4-fb89-4476-a41d-e598f613e2a0', amount: 120 }
    ]
  },
  {
    slug: 'omelette-toast',
    name: 'Omelette toast',
    hour: 8,
    minute: 40,
    items: [
      { ingredientUuid: 'b478eccf-58de-4c75-9d0f-4cdac2839cae', amount: 3 },
      { ingredientUuid: '9be69650-2300-48c0-b2dc-26cc2258a372', amount: 2 },
      { ingredientUuid: 'a1de2e25-7b09-4f5f-bfd6-362b7d846e81', amount: 1 }
    ]
  },
  {
    slug: 'banana-yogurt-cup',
    name: 'Banana yogurt cup',
    hour: 16,
    minute: 20,
    items: [
      { ingredientUuid: '34abf9fa-137b-41cc-bd8d-0817dd6f8440', amount: 180 },
      { ingredientUuid: 'f9fe96a4-fb89-4476-a41d-e598f613e2a0', amount: 140 }
    ]
  },
  {
    slug: 'grilled-cheese-sandwich',
    name: 'Grilled cheese sandwich',
    hour: 20,
    minute: 10,
    items: [
      { ingredientUuid: '9be69650-2300-48c0-b2dc-26cc2258a372', amount: 2 },
      { ingredientUuid: 'a1de2e25-7b09-4f5f-bfd6-362b7d846e81', amount: 2 },
      { ingredientUuid: 'c67dade5-c61a-4097-b940-16ff446ccc89', amount: 0.3 }
    ]
  },
  {
    slug: 'ham-toast-snack',
    name: 'Ham toast snack',
    hour: 11,
    minute: 30,
    items: [
      { ingredientUuid: '9be69650-2300-48c0-b2dc-26cc2258a372', amount: 1 },
      { ingredientUuid: 'f18f2f2e-e777-4629-b3d0-3f7a3ea61455', amount: 2 },
      { ingredientUuid: 'c67dade5-c61a-4097-b940-16ff446ccc89', amount: 0.4 }
    ]
  }
]

const EXAMPLE_DAY_MEAL_PLAN_INDEXES: number[][] = [
  [0, 1, 2],
  [3, 4, 1],
  [5, 2, 6],
  [0, 4, 5],
  [3, 1, 6],
  [2, 6, 0],
  [5, 4, 3]
]

const isLoaded = ref(false)
const isSaving = ref(false)
const isSavingAiIntegration = ref(false)
const isTestingAiIntegrationKey = ref(false)
const isClearingData = ref(false)
const isGeneratingExampleData = ref(false)
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
const sampleDataError = ref('')
const sampleDataNotice = ref('')
const isAiSetupModalOpen = ref(false)
const aiSetupStep = ref<'pin' | 'provider'>('pin')
const aiSetupError = ref('')
const aiSetupPin = ref('')
const aiSetupProvider = ref<AiProvider>(DEFAULT_AI_PROVIDER)
const aiSetupApiKey = ref('')
const isAiChangeProviderModalOpen = ref(false)
const aiChangeProviderError = ref('')
const aiChangeProviderCurrentPin = ref('')
const aiChangeProviderProvider = ref<AiProvider>(DEFAULT_AI_PROVIDER)
const aiChangeProviderApiKey = ref('')
const isAiChangePasswordModalOpen = ref(false)
const aiChangePasswordError = ref('')
const aiChangePasswordCurrentPin = ref('')
const aiChangePasswordNewPin = ref('')
const isAiUnlockModalOpen = ref(false)
const aiUnlockError = ref('')
const aiUnlockPin = ref('')

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

onMounted(async () => {
  try {
    const [settings, metadata] = await Promise.all([
      readAppSettings(),
      readAiIntegrationMetadata()
    ])
    currentSettings.value = settings
    aiIntegration.value = metadata
    isAiUnlocked.value = getIsAiIntegrationUnlocked()
    setGoalFormValues(settings)
  }
  catch (error) {
    console.error('Failed to load settings from IndexedDB', error)
    formError.value = 'Could not load settings. Using default goals for now.'
    setGoalFormDefaults()
    currentSettings.value = createDefaultAppSettings()
  }
  finally {
    isLoaded.value = true
  }
})

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
  }
  catch (error) {
    console.error('Failed to save settings to IndexedDB', error)
    formError.value = 'Could not save settings. Try again.'
  }
  finally {
    isSaving.value = false
  }
}

function providerLabel(provider: AiProvider) {
  return provider === 'openai' ? 'OpenAI' : 'Anthropic'
}

function openAiSetupModal() {
  resetAiSetupModal()
  aiSetupStep.value = 'pin'
  isAiSetupModalOpen.value = true
}

function closeAiSetupModal() {
  isAiSetupModalOpen.value = false
  resetAiSetupModal()
}

function resetAiSetupModal() {
  aiSetupStep.value = 'pin'
  aiSetupError.value = ''
  aiSetupPin.value = ''
  aiSetupProvider.value = DEFAULT_AI_PROVIDER
  aiSetupApiKey.value = ''
}

function continueAiSetupToProviderStep() {
  aiSetupError.value = ''

  if (!isValidAiPin(aiSetupPin.value)) {
    aiSetupError.value = 'Encryption password must be exactly 4 digits.'
    return
  }

  aiSetupStep.value = 'provider'
}

async function saveAiIntegrationSetup() {
  aiSetupError.value = ''
  aiIntegrationError.value = ''
  aiIntegrationNotice.value = ''

  if (!isValidAiPin(aiSetupPin.value)) {
    aiSetupError.value = 'Encryption password must be exactly 4 digits.'
    return
  }

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
      apiKey,
      pin: aiSetupPin.value
    })
    isAiUnlocked.value = true
    aiIntegrationNotice.value = 'AI integration set up and unlocked in this tab.'
    dangerError.value = ''
    dangerNotice.value = ''
    closeAiSetupModal()
  }
  catch (error) {
    console.error('Failed to set up AI integration', error)
    aiSetupError.value = error instanceof Error ? error.message : 'Could not set up AI integration.'
  }
  finally {
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
    aiUnlockError.value = 'Encryption password must be exactly 4 digits.'
    return
  }

  isSavingAiIntegration.value = true

  try {
    aiIntegration.value = await unlockAiIntegration(aiUnlockPin.value)
    isAiUnlocked.value = true
    aiIntegrationNotice.value = 'AI integration unlocked in this tab.'
    closeAiUnlockModal()
  }
  catch (error) {
    aiUnlockError.value = error instanceof Error ? error.message : 'Could not unlock AI integration.'
  }
  finally {
    isSavingAiIntegration.value = false
  }
}

function lockAiIntegrationForSession() {
  lockAiIntegration()
  isAiUnlocked.value = false
  aiIntegrationNotice.value = 'AI integration locked.'
  aiIntegrationError.value = ''
}

async function clearAiIntegrationFromDevice() {
  aiIntegrationError.value = ''
  aiIntegrationNotice.value = ''

  if (!aiIntegration.value) {
    return
  }

  if (typeof window !== 'undefined') {
    const confirmed = window.confirm(
      'This will remove the encrypted AI integration key from this browser. Continue?'
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
    aiIntegrationNotice.value = 'AI integration removed from this browser.'
  }
  catch (error) {
    console.error('Failed to clear AI integration', error)
    aiIntegrationError.value = 'Could not clear AI integration. Try again.'
  }
  finally {
    isSavingAiIntegration.value = false
  }
}

function openAiChangeProviderModal() {
  if (!aiIntegration.value) {
    return
  }

  aiChangeProviderError.value = ''
  aiChangeProviderCurrentPin.value = ''
  aiChangeProviderProvider.value = aiIntegration.value.provider
  aiChangeProviderApiKey.value = ''
  isAiChangeProviderModalOpen.value = true
}

function closeAiChangeProviderModal() {
  aiChangeProviderError.value = ''
  aiChangeProviderCurrentPin.value = ''
  aiChangeProviderProvider.value = aiIntegration.value?.provider ?? DEFAULT_AI_PROVIDER
  aiChangeProviderApiKey.value = ''
  isAiChangeProviderModalOpen.value = false
}

async function submitAiChangeProvider() {
  aiChangeProviderError.value = ''
  aiIntegrationError.value = ''
  aiIntegrationNotice.value = ''

  if (!isValidAiPin(aiChangeProviderCurrentPin.value)) {
    aiChangeProviderError.value = 'Current encryption password must be exactly 4 digits.'
    return
  }

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
      apiKey,
      currentPin: aiChangeProviderCurrentPin.value
    })
    isAiUnlocked.value = true
    aiIntegrationNotice.value = 'Provider/key updated and re-encrypted.'
    closeAiChangeProviderModal()
  }
  catch (error) {
    console.error('Failed to change AI provider/key', error)
    aiChangeProviderError.value = error instanceof Error ? error.message : 'Could not update provider/key.'
  }
  finally {
    isTestingAiIntegrationKey.value = false
    isSavingAiIntegration.value = false
  }
}

function openAiChangePasswordModal() {
  if (!aiIntegration.value) {
    return
  }

  aiChangePasswordError.value = ''
  aiChangePasswordCurrentPin.value = ''
  aiChangePasswordNewPin.value = ''
  isAiChangePasswordModalOpen.value = true
}

function closeAiChangePasswordModal() {
  aiChangePasswordError.value = ''
  aiChangePasswordCurrentPin.value = ''
  aiChangePasswordNewPin.value = ''
  isAiChangePasswordModalOpen.value = false
}

async function submitAiChangePassword() {
  aiChangePasswordError.value = ''
  aiIntegrationError.value = ''
  aiIntegrationNotice.value = ''

  if (!isValidAiPin(aiChangePasswordCurrentPin.value)) {
    aiChangePasswordError.value = 'Current encryption password must be exactly 4 digits.'
    return
  }

  if (!isValidAiPin(aiChangePasswordNewPin.value)) {
    aiChangePasswordError.value = 'New encryption password must be exactly 4 digits.'
    return
  }

  isSavingAiIntegration.value = true

  try {
    aiIntegration.value = await changeAiIntegrationPassword({
      currentPin: aiChangePasswordCurrentPin.value,
      newPin: aiChangePasswordNewPin.value
    })
    isAiUnlocked.value = true
    aiIntegrationNotice.value = 'Encryption password updated.'
    closeAiChangePasswordModal()
  }
  catch (error) {
    console.error('Failed to change AI encryption password', error)
    aiChangePasswordError.value = error instanceof Error ? error.message : 'Could not change encryption password.'
  }
  finally {
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

async function generateExampleData() {
  sampleDataError.value = ''
  sampleDataNotice.value = ''

  isGeneratingExampleData.value = true

  try {
    const [existingIngredients, existingMeals] = await Promise.all([
      readClientCollection<unknown>(INGREDIENTS_COLLECTION_KEY),
      readClientCollection<unknown>(MEALS_COLLECTION_KEY)
    ])

    const { ingredients: exampleIngredients, meals: exampleMeals } = createExampleData()

    const mergedIngredients = [
      ...existingIngredients.filter(item => !collectionItemHasIdPrefix(item, EXAMPLE_INGREDIENT_ID_PREFIX)),
      ...exampleIngredients
    ]
    const mergedMeals = [
      ...existingMeals.filter(item => !collectionItemHasIdPrefix(item, EXAMPLE_MEAL_ID_PREFIX)),
      ...exampleMeals
    ]

    await Promise.all([
      writeClientCollection(INGREDIENTS_COLLECTION_KEY, mergedIngredients),
      writeClientCollection(MEALS_COLLECTION_KEY, mergedMeals)
    ])

    sampleDataNotice.value = `Added example data: ${exampleIngredients.length} ingredients and ${exampleMeals.length} meals across the last 7 days.`
    sampleDataError.value = ''
    dangerError.value = ''
    dangerNotice.value = ''
  }
  catch (error) {
    console.error('Failed to generate example data', error)
    sampleDataError.value = 'Could not generate example data. Try again.'
  }
  finally {
    isGeneratingExampleData.value = false
  }
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
    sampleDataError.value = ''
    sampleDataNotice.value = ''
    isRecommendationModalOpen.value = false
    isAiSetupModalOpen.value = false
    isAiChangeProviderModalOpen.value = false
    isAiChangePasswordModalOpen.value = false
    isAiUnlockModalOpen.value = false
    dangerNotice.value = 'All local data was cleared from this browser.'
  }
  catch (error) {
    console.error('Failed to clear local IndexedDB data', error)
    dangerError.value = 'Could not clear local data. Try again.'
  }
  finally {
    isClearingData.value = false
  }
}

function createExampleData() {
  const ingredientCreatedAt = daysAgoAtIso(6, 9, 0)
  const ingredients = EXAMPLE_INGREDIENT_SEEDS.map(seed => createExampleIngredientRecord(seed, ingredientCreatedAt))
  const ingredientsByUuid = new Map(ingredients.map(ingredient => [ingredient.uuid, ingredient]))
  const meals: ExampleMealRecord[] = []

  for (let daysAgo = 0; daysAgo < 7; daysAgo += 1) {
    const dayPlan = EXAMPLE_DAY_MEAL_PLAN_INDEXES[daysAgo] ?? [0, 1, 2]

    for (let templateIndex = 0; templateIndex < dayPlan.length; templateIndex += 1) {
      const template = EXAMPLE_MEAL_SEEDS[dayPlan[templateIndex] ?? -1]

      if (!template) {
        continue
      }

      const meal = createExampleMealRecord({
        seed: template,
        daysAgo,
        index: templateIndex,
        ingredientsByUuid
      })

      meals.push(meal)
    }
  }

  return { ingredients, meals }
}

function createExampleIngredientRecord(seed: ExampleIngredientSeed, createdAt: string): ExampleIngredientRecord {
  return {
    id: `${EXAMPLE_INGREDIENT_ID_PREFIX}${seed.slug}`,
    uuid: seed.uuid,
    name: seed.name,
    unit: seed.unit,
    portionSize: roundToThree(seed.portionSize),
    kcal: Math.round(seed.kcal),
    protein: roundToOne(seed.protein),
    carbs: roundToOne(seed.carbs),
    fat: roundToOne(seed.fat),
    kcalPerUnit: roundToSix(seed.kcal / seed.portionSize),
    proteinPerUnit: roundToSix(seed.protein / seed.portionSize),
    carbsPerUnit: roundToSix(seed.carbs / seed.portionSize),
    fatPerUnit: roundToSix(seed.fat / seed.portionSize),
    createdAt
  }
}

function createExampleMealRecord(input: {
  seed: ExampleMealSeed
  daysAgo: number
  index: number
  ingredientsByUuid: Map<string, ExampleIngredientRecord>
}): ExampleMealRecord {
  let calories = 0
  let protein = 0
  let carbs = 0
  let fat = 0

  const ingredients: ExampleMealIngredientSnapshot[] = input.seed.items.flatMap((item) => {
    const ingredient = input.ingredientsByUuid.get(item.ingredientUuid)

    if (!ingredient) {
      return []
    }

    calories += ingredient.kcalPerUnit * item.amount
    protein += ingredient.proteinPerUnit * item.amount
    carbs += ingredient.carbsPerUnit * item.amount
    fat += ingredient.fatPerUnit * item.amount

    return [{
      name: ingredient.name,
      amount: roundToThree(item.amount),
      unit: ingredient.unit
    }]
  })

  return {
    id: `${EXAMPLE_MEAL_ID_PREFIX}${input.daysAgo}-${input.seed.slug}-${input.index}`,
    name: input.seed.name,
    calories: Math.round(calories),
    protein: roundToOne(protein),
    carbs: roundToOne(carbs),
    fat: roundToOne(fat),
    ingredients,
    createdAt: daysAgoAtIso(input.daysAgo, input.seed.hour, input.seed.minute)
  }
}

function daysAgoAtIso(daysAgo: number, hour: number, minute: number) {
  const date = new Date()
  date.setHours(hour, minute, 0, 0)
  date.setDate(date.getDate() - daysAgo)
  return date.toISOString()
}

function collectionItemHasIdPrefix(value: unknown, prefix: string) {
  if (!value || typeof value !== 'object') {
    return false
  }

  const maybeId = (value as { id?: unknown }).id
  return typeof maybeId === 'string' && maybeId.startsWith(prefix)
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

function roundToOne(value: number) {
  return Math.round(value * 10) / 10
}

function roundToThree(value: number) {
  return Math.round(value * 1000) / 1000
}

function roundToSix(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000
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
  }
  else if (input.objective === 'gain') {
    ({ proteinGoal, carbsGoal, fatGoal } = macrosFromPercentSplit(dailyCalorieGoal, {
      protein: 0.20,
      carbs: 0.55,
      fat: 0.25
    }))
  }
  else if (input.objective === 'muscle') {
    const fatGoalRaw = (dailyCalorieGoal * 0.25) / 9
    const baseProteinGoal = (dailyCalorieGoal * 0.25) / 4
    const proteinFloor = input.weightKg * 1.6
    const proteinGoalRaw = Math.max(baseProteinGoal, proteinFloor)
    const carbsCalories = Math.max(0, dailyCalorieGoal - (proteinGoalRaw * 4) - (fatGoalRaw * 9))

    proteinGoal = Math.round(proteinGoalRaw)
    fatGoal = Math.round(fatGoalRaw)
    carbsGoal = Math.round(carbsCalories / 4)
  }
  else {
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
        sedentary: 1.00,
        'low-active': 1.11,
        active: 1.25,
        'very-active': 1.48
      }
    : {
        sedentary: 1.00,
        'low-active': 1.12,
        active: 1.27,
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
          Configure app defaults stored only in this browser.
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
        <div>
          <h2 class="text-lg font-semibold text-highlighted">
            Goals
          </h2>
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

          <div class="rounded-xl border border-default bg-muted/15 px-4 py-3">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p class="text-sm font-medium text-highlighted">
                  Need a starting point?
                </p>
                <p class="text-sm text-muted">
                  Use a general recommendation based on age, sex, height, weight, activity level and objective.
                </p>
              </div>

              <UButton
                type="button"
                color="neutral"
                variant="soft"
                icon="i-lucide-wand-sparkles"
                class="justify-center"
                @click="openRecommendationModal"
              >
                Recommend goals
              </UButton>
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

          <div class="flex justify-end">
            <UButton
              type="submit"
              size="lg"
              :loading="isSaving"
            >
              Save settings
            </UButton>
          </div>
        </form>
      </div>
    </UCard>

    <UCard>
      <div class="space-y-4">
        <div>
          <h2 class="text-lg font-semibold text-highlighted">
            AI Integration
          </h2>
          <p class="text-sm text-muted">
            Connect one AI provider key and protect it with a local 4-digit encryption password. The key is encrypted before being stored in this browser.
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
                  :color="isAiUnlocked ? 'success' : 'neutral'"
                  variant="soft"
                >
                  {{ isAiUnlocked ? 'Unlocked' : 'Locked' }}
                </UBadge>
              </div>
            </div>
          </div>

          <p class="text-xs text-muted">
            The decrypted API key is kept only in memory after unlock and is cleared when you lock it or reload the page.
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
              v-if="!isAiUnlocked"
              type="button"
              color="neutral"
              variant="soft"
              icon="i-lucide-unlock"
              :loading="isSavingAiIntegration"
              @click="openAiUnlockModal"
            >
              Unlock
            </UButton>

            <UButton
              v-else
              type="button"
              color="neutral"
              variant="soft"
              icon="i-lucide-lock"
              @click="lockAiIntegrationForSession"
            >
              Lock
            </UButton>

            <UButton
              type="button"
              color="neutral"
              variant="soft"
              icon="i-lucide-refresh-cw"
              :loading="isSavingAiIntegration || isTestingAiIntegrationKey"
              @click="openAiChangeProviderModal"
            >
              Change provider
            </UButton>

            <UButton
              type="button"
              color="neutral"
              variant="soft"
              icon="i-lucide-key-round"
              :loading="isSavingAiIntegration"
              @click="openAiChangePasswordModal"
            >
              Change encryption password
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

    <UCard>
      <div class="space-y-4">
        <div>
          <h2 class="text-lg font-semibold text-highlighted">
            Sample Data
          </h2>
          <p class="text-sm text-muted">
            Generate example ingredients and meal history for the last 7 days. Existing sample entries are replaced; your other data is kept.
          </p>
        </div>

        <p
          v-if="sampleDataError"
          class="text-sm text-error"
        >
          {{ sampleDataError }}
        </p>

        <p
          v-else-if="sampleDataNotice"
          class="text-sm text-success"
        >
          {{ sampleDataNotice }}
        </p>

        <div class="flex justify-end">
          <UButton
            type="button"
            color="neutral"
            variant="soft"
            icon="i-lucide-sparkles"
            :loading="isGeneratingExampleData"
            @click="generateExampleData"
          >
            Create example data (7 days)
          </UButton>
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
      v-model:open="isAiSetupModalOpen"
      title="Setup AI integration"
      :description="aiSetupStep === 'pin'
        ? 'Set a 4-digit encryption password. It will be used to encrypt your API key before storing it in this browser.'
        : 'Choose a provider and API key. The key will be tested before being encrypted and saved.'"
    >
      <template #body>
        <div class="space-y-4">
          <div
            v-if="aiSetupStep === 'pin'"
            class="space-y-4"
          >
            <div class="rounded-lg border border-default bg-muted/15 px-4 py-3 text-sm text-muted">
              Your encryption password is local to this browser and is required to unlock the AI integration later.
            </div>

            <div class="space-y-2">
              <label
                for="ai-setup-pin"
                class="block text-sm font-medium text-highlighted"
              >
                Encryption password (4 digits)
              </label>
              <UInput
                id="ai-setup-pin"
                v-model="aiSetupPin"
                type="password"
                inputmode="numeric"
                autocomplete="off"
                maxlength="4"
                placeholder="1234"
              />
            </div>
          </div>

          <div
            v-else
            class="space-y-4"
          >
            <div class="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
              <div class="space-y-2">
                <label
                  for="ai-setup-provider"
                  class="block text-sm font-medium text-highlighted"
                >
                  Provider
                </label>
                <select
                  id="ai-setup-provider"
                  v-model="aiSetupProvider"
                  class="w-full rounded-[calc(var(--ui-radius)*1px)] border border-default bg-default px-3 py-2.5 text-sm text-highlighted outline-none ring-0 transition focus:border-primary"
                >
                  <option value="openai">
                    OpenAI
                  </option>
                  <option value="anthropic">
                    Anthropic
                  </option>
                </select>
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
            v-if="aiSetupStep === 'provider'"
            type="button"
            color="neutral"
            variant="ghost"
            :disabled="isSavingAiIntegration || isTestingAiIntegrationKey"
            @click="aiSetupStep = 'pin'"
          >
            Back
          </UButton>

          <UButton
            v-if="aiSetupStep === 'pin'"
            type="button"
            icon="i-lucide-arrow-right"
            @click="continueAiSetupToProviderStep"
          >
            Continue
          </UButton>

          <UButton
            v-else
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
      title="Unlock AI integration"
      description="Enter your 4-digit encryption password to decrypt the provider key for this session."
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
              Encryption password (4 digits)
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
              Unlock
            </UButton>
          </div>
        </form>
      </template>
    </UModal>

    <UModal
      v-model:open="isAiChangeProviderModalOpen"
      title="Change provider"
      description="Enter your current encryption password, then provide a new provider API key. The new key is tested before replacing the current one."
    >
      <template #body>
        <form
          class="space-y-4"
          @submit.prevent="submitAiChangeProvider"
        >
          <div class="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
            <div class="space-y-2">
              <label
                for="ai-change-provider-current-pin"
                class="block text-sm font-medium text-highlighted"
              >
                Current encryption password
              </label>
              <UInput
                id="ai-change-provider-current-pin"
                v-model="aiChangeProviderCurrentPin"
                type="password"
                inputmode="numeric"
                autocomplete="off"
                maxlength="4"
                placeholder="1234"
              />
            </div>

            <div class="space-y-2">
              <label
                for="ai-change-provider-select"
                class="block text-sm font-medium text-highlighted"
              >
                Provider
              </label>
              <select
                id="ai-change-provider-select"
                v-model="aiChangeProviderProvider"
                class="w-full rounded-[calc(var(--ui-radius)*1px)] border border-default bg-default px-3 py-2.5 text-sm text-highlighted outline-none ring-0 transition focus:border-primary"
              >
                <option value="openai">
                  OpenAI
                </option>
                <option value="anthropic">
                  Anthropic
                </option>
              </select>
            </div>
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
      v-model:open="isAiChangePasswordModalOpen"
      title="Change encryption password"
      description="Re-encrypt your stored AI key with a new 4-digit encryption password."
    >
      <template #body>
        <form
          class="space-y-4"
          @submit.prevent="submitAiChangePassword"
        >
          <div class="grid gap-4 md:grid-cols-2">
            <div class="space-y-2">
              <label
                for="ai-change-password-current"
                class="block text-sm font-medium text-highlighted"
              >
                Current password
              </label>
              <UInput
                id="ai-change-password-current"
                v-model="aiChangePasswordCurrentPin"
                type="password"
                inputmode="numeric"
                autocomplete="off"
                maxlength="4"
                placeholder="1234"
              />
            </div>

            <div class="space-y-2">
              <label
                for="ai-change-password-new"
                class="block text-sm font-medium text-highlighted"
              >
                New password
              </label>
              <UInput
                id="ai-change-password-new"
                v-model="aiChangePasswordNewPin"
                type="password"
                inputmode="numeric"
                autocomplete="off"
                maxlength="4"
                placeholder="5678"
              />
            </div>
          </div>

          <p
            v-if="aiChangePasswordError"
            class="text-sm text-error"
          >
            {{ aiChangePasswordError }}
          </p>

          <div class="flex flex-col-reverse items-end gap-2 sm:flex-row sm:justify-end">
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              :disabled="isSavingAiIntegration"
              @click="closeAiChangePasswordModal"
            >
              Cancel
            </UButton>
            <UButton
              type="submit"
              icon="i-lucide-key-round"
              :loading="isSavingAiIntegration"
            >
              Save password
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
              <select
                id="rec-sex"
                v-model="recommendationForm.sex"
                class="w-full rounded-[calc(var(--ui-radius)*1px)] border border-default bg-default px-3 py-2.5 text-sm text-highlighted outline-none ring-0 transition focus:border-primary"
              >
                <option value="female">
                  Female
                </option>
                <option value="male">
                  Male
                </option>
              </select>
            </div>

            <div class="space-y-2">
              <label
                for="rec-activity"
                class="block text-sm font-medium text-highlighted"
              >
                Activity level
              </label>
              <select
                id="rec-activity"
                v-model="recommendationForm.activityLevel"
                class="w-full rounded-[calc(var(--ui-radius)*1px)] border border-default bg-default px-3 py-2.5 text-sm text-highlighted outline-none ring-0 transition focus:border-primary"
              >
                <option value="sedentary">
                  Sedentary
                </option>
                <option value="low-active">
                  Low active
                </option>
                <option value="active">
                  Active
                </option>
                <option value="very-active">
                  Very active
                </option>
              </select>
            </div>
          </div>

          <div class="space-y-2">
            <label
              for="rec-objective"
              class="block text-sm font-medium text-highlighted"
            >
              Objective
            </label>
            <select
              id="rec-objective"
              v-model="recommendationForm.objective"
              class="w-full rounded-[calc(var(--ui-radius)*1px)] border border-default bg-default px-3 py-2.5 text-sm text-highlighted outline-none ring-0 transition focus:border-primary"
            >
              <option value="loss">
                Weight loss
              </option>
              <option value="maintenance">
                Maintenance
              </option>
              <option value="gain">
                Weight gain
              </option>
              <option value="muscle">
                Build muscle
              </option>
            </select>
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
