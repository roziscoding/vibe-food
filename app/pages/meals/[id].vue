<script setup lang="ts">
import {
  clearMealImportEditorDraft,
  readMealImportEditorDraft
} from '../../utils/meal-import-editor-draft'
import { readIngredients, writeIngredients } from '../../utils/db/repos/ingredients'
import type { IngredientRecord } from '../../utils/db/repos/ingredients'
import { readMeals, writeMeals } from '../../utils/db/repos/meals'
import type { MealIngredientSnapshotRecord, MealRecord } from '../../utils/db/repos/meals'
import { MACRO_COLORS } from '../../utils/nutrition-colors'

type MealEntryMode = 'manual' | 'ingredients'
type RouteMealEditorMode = 'new' | 'import' | 'edit' | 'empty'

type MealIngredientSnapshot = MealIngredientSnapshotRecord
type MealEntry = MealRecord
type IngredientReference = IngredientRecord

type MealIngredientRow = {
  id: string
  ingredientId: string
  quantity: string | number
}

type IngredientEditorFormState = {
  name: string
  portionSize: string
  unit: string
  kcal: string
  protein: string
  carbs: string
  fat: string
}

type MealFormState = {
  name: string
  calories: string
  protein: string
  carbs: string
  fat: string
  entryMode: MealEntryMode
}

type ImportedMealMatch = {
  ingredient_id: string
  amount: number
}

type ImportedNewIngredient = {
  name: string
  unit: string
  portion_size: number
  calories: number
  carbs: number
  proteins?: number
  protein?: number
  fat: number
}

type ImportedMealPayload = {
  matched_ingredients: ImportedMealMatch[]
  new_ingredients?: ImportedNewIngredient[]
}

const route = useRoute()

const pageMode = ref<RouteMealEditorMode>('empty')
const isLoaded = ref(false)
const isSaving = ref(false)
const pageError = ref('')
const saveError = ref('')
const importSource = ref<'ai' | 'manual' | null>(null)

const meals = ref<MealEntry[]>([])
const baseIngredients = ref<IngredientReference[]>([])
const stagedImportedIngredients = ref<IngredientReference[]>([])
const editingMealId = ref<string | null>(null)
const preservedManualSnapshots = ref<MealIngredientSnapshot[]>([])

const formDate = ref('')
const formTime = ref('')
const formError = ref('')
const isStagedIngredientEditorOpen = ref(false)
const stagedIngredientEditorTargetId = ref<string | null>(null)
const stagedIngredientEditorError = ref('')
const stagedIngredientEditorForm = reactive<IngredientEditorFormState>({
  name: '',
  portionSize: '',
  unit: '',
  kcal: '',
  protein: '',
  carbs: '',
  fat: ''
})

const form = reactive<MealFormState>({
  name: '',
  calories: '',
  protein: '',
  carbs: '',
  fat: '',
  entryMode: 'manual'
})

const mealIngredientRows = ref<MealIngredientRow[]>([createMealIngredientRow()])

const allIngredients = computed(() => {
  return [...stagedImportedIngredients.value, ...baseIngredients.value]
})

const sortedIngredients = computed(() => {
  return [...allIngredients.value].sort((a, b) => a.name.localeCompare(b.name))
})

const ingredientsById = computed(() => {
  return new Map(allIngredients.value.map(ingredient => [ingredient.id, ingredient]))
})

const ingredientsByUuid = computed(() => {
  return new Map(
    allIngredients.value
      .filter(ingredient => ingredient.uuid.trim().length > 0)
      .map(ingredient => [ingredient.uuid, ingredient])
  )
})

const ingredientSelectOptions = computed(() => {
  return sortedIngredients.value.map(ingredient => ({
    label: ingredientOptionLabel(ingredient),
    value: ingredient.id
  }))
})

const routeMealId = computed(() => {
  const value = route.params.id

  if (typeof value === 'string') {
    return value.trim()
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0].trim()
  }

  return ''
})

const isEditingExistingMeal = computed(() => pageMode.value === 'edit' && !!editingMealId.value)

const pageTitle = computed(() => {
  if (pageMode.value === 'new') {
    return 'New Meal'
  }

  if (pageMode.value === 'import') {
    return 'Import Meal'
  }

  if (pageMode.value === 'edit') {
    return 'Edit Meal'
  }

  return 'Meal Editor'
})

const pageDescription = computed(() => {
  if (pageMode.value === 'import') {
    return 'Review the AI/manual import and adjust the meal before saving.'
  }

  if (pageMode.value === 'edit') {
    return 'Update an existing meal using the same flow as creating a new one.'
  }

  return 'Create a meal manually or compose it from saved ingredients.'
})

const submitButtonLabel = computed(() => {
  return isEditingExistingMeal.value ? 'Save changes' : 'Save meal'
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

const hasIngredients = computed(() => sortedIngredients.value.length > 0)

onMounted(async () => {
  await loadPage()
})

watch(() => routeMealId.value, () => {
  if (isLoaded.value) {
    void loadPage()
  }
})

function setEntryMode(mode: MealEntryMode) {
  form.entryMode = mode
  formError.value = ''

  if (mode === 'ingredients' && mealIngredientRows.value.length === 0) {
    mealIngredientRows.value = [createMealIngredientRow()]
  }
}

function addMealIngredientRow() {
  mealIngredientRows.value = [...mealIngredientRows.value, createMealIngredientRow()]
}

function removeMealIngredientRow(rowId: string) {
  if (mealIngredientRows.value.length <= 1) {
    mealIngredientRows.value = [createMealIngredientRow()]
    return
  }

  mealIngredientRows.value = mealIngredientRows.value.filter(row => row.id !== rowId)
}

function quantityLabelForRow(row: MealIngredientRow) {
  const ingredient = row.ingredientId ? ingredientsById.value.get(row.ingredientId) : null
  return ingredient ? `Qty (${ingredient.unit})` : 'Qty'
}

function ingredientOptionLabel(ingredient: IngredientReference) {
  return `${ingredient.name} (${formatDensity(ingredient.kcalPerUnit)} kcal/${ingredient.unit})`
}

function formatIngredientPortionSummary(ingredient: IngredientReference) {
  return `${formatEditableQuantity(ingredient.portionSize)} ${ingredient.unit}`
}

async function loadPage() {
  isLoaded.value = false
  pageError.value = ''
  saveError.value = ''
  formError.value = ''
  importSource.value = null
  editingMealId.value = null
  preservedManualSnapshots.value = []
  stagedImportedIngredients.value = []

  const [loadedMeals, loadedIngredients] = await Promise.all([
    loadMealsFromDb(),
    loadIngredientsFromDb()
  ])

  meals.value = loadedMeals
  baseIngredients.value = loadedIngredients

  resetForm()

  const id = routeMealId.value

  if (!id) {
    pageMode.value = 'empty'
    pageError.value = 'Missing meal editor route parameter.'
    isLoaded.value = true
    return
  }

  if (id === 'new') {
    initNewMode()
    isLoaded.value = true
    return
  }

  if (id === 'import') {
    initImportMode()
    isLoaded.value = true
    return
  }

  initExistingMealMode(id)
  isLoaded.value = true
}

function initNewMode() {
  pageMode.value = 'new'
  setFormDateTime(getQueryDateOrToday(), new Date())
  form.entryMode = 'ingredients'
}

function initImportMode() {
  pageMode.value = 'import'

  const draft = readMealImportEditorDraft()

  if (!draft) {
    pageMode.value = 'empty'
    pageError.value = 'No import draft found. Start from Meals → AI import or JSON import.'
    return
  }

  importSource.value = draft.source ?? null
  form.name = draft.mealName.trim() || 'Imported meal'
  setFormDateTime(draft.targetDateKey || getQueryDateOrToday(), new Date())
  form.entryMode = 'ingredients'

  const parsed = parseImportedPayloadFromJson(draft.json)

  if (!parsed.ok) {
    pageMode.value = 'empty'
    pageError.value = parsed.error
    return
  }

  const payload = parsed.payload
  const importRows: MealIngredientRow[] = []
  const pendingIngredients: IngredientReference[] = []

  if (Array.isArray(payload.new_ingredients)) {
    for (const item of payload.new_ingredients) {
      const ingredient = createImportedIngredient(item as Partial<ImportedNewIngredient>)

      if (!ingredient) {
        pageMode.value = 'empty'
        pageError.value = 'One imported new ingredient is invalid. Review the AI/manual import and try again.'
        return
      }

      pendingIngredients.push(ingredient)
      importRows.push({
        id: createLocalId(),
        ingredientId: ingredient.id,
        quantity: formatEditableQuantity(ingredient.portionSize)
      })
    }
  }

  stagedImportedIngredients.value = pendingIngredients

  for (const item of payload.matched_ingredients) {
    if (!item || typeof item !== 'object') {
      pageMode.value = 'empty'
      pageError.value = 'Each matched ingredient entry must be an object.'
      return
    }

    const { ingredient_id, amount } = item as Partial<ImportedMealMatch>

    if (typeof ingredient_id !== 'string' || ingredient_id.trim().length === 0) {
      pageMode.value = 'empty'
      pageError.value = 'Each matched ingredient must include a valid ingredient_id.'
      return
    }

    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      pageMode.value = 'empty'
      pageError.value = 'Each matched ingredient must include an amount greater than 0.'
      return
    }

    const ingredient = ingredientsByUuid.value.get(ingredient_id.trim())

    if (!ingredient) {
      pageMode.value = 'empty'
      pageError.value = `Ingredient not found for ID: ${ingredient_id}`
      return
    }

    importRows.push({
      id: createLocalId(),
      ingredientId: ingredient.id,
      quantity: formatEditableQuantity(amount)
    })
  }

  mealIngredientRows.value = importRows.length > 0 ? importRows : [createMealIngredientRow()]
}

function openStagedIngredientEditor(ingredientId: string) {
  const ingredient = stagedImportedIngredients.value.find(item => item.id === ingredientId)

  if (!ingredient) {
    return
  }

  stagedIngredientEditorTargetId.value = ingredient.id
  stagedIngredientEditorError.value = ''
  stagedIngredientEditorForm.name = ingredient.name
  stagedIngredientEditorForm.portionSize = formatEditableQuantity(ingredient.portionSize)
  stagedIngredientEditorForm.unit = ingredient.unit
  stagedIngredientEditorForm.kcal = String(ingredient.kcal)
  stagedIngredientEditorForm.protein = formatEditableQuantity(ingredient.protein)
  stagedIngredientEditorForm.carbs = formatEditableQuantity(ingredient.carbs)
  stagedIngredientEditorForm.fat = formatEditableQuantity(ingredient.fat)
  isStagedIngredientEditorOpen.value = true
}

function closeStagedIngredientEditor() {
  isStagedIngredientEditorOpen.value = false
  stagedIngredientEditorTargetId.value = null
  stagedIngredientEditorError.value = ''
}

function saveStagedIngredientEdits() {
  stagedIngredientEditorError.value = ''

  const targetId = stagedIngredientEditorTargetId.value

  if (!targetId) {
    stagedIngredientEditorError.value = 'No ingredient selected.'
    return
  }

  const nextValues = parseIngredientEditorForm(stagedIngredientEditorForm)

  if (!nextValues.ok) {
    stagedIngredientEditorError.value = nextValues.error
    return
  }

  let updated = false
  stagedImportedIngredients.value = stagedImportedIngredients.value.map((ingredient) => {
    if (ingredient.id !== targetId) {
      return ingredient
    }

    updated = true

    return {
      ...ingredient,
      name: nextValues.value.name,
      unit: nextValues.value.unit,
      portionSize: nextValues.value.portionSize,
      kcal: nextValues.value.kcal,
      protein: nextValues.value.protein,
      carbs: nextValues.value.carbs,
      fat: nextValues.value.fat,
      kcalPerUnit: roundToSix(nextValues.value.kcal / nextValues.value.portionSize),
      proteinPerUnit: roundToSix(nextValues.value.protein / nextValues.value.portionSize),
      carbsPerUnit: roundToSix(nextValues.value.carbs / nextValues.value.portionSize),
      fatPerUnit: roundToSix(nextValues.value.fat / nextValues.value.portionSize)
    }
  })

  if (!updated) {
    stagedIngredientEditorError.value = 'Ingredient not found.'
    return
  }

  closeStagedIngredientEditor()
}

function removeStagedIngredient(ingredientId: string) {
  stagedImportedIngredients.value = stagedImportedIngredients.value.filter(item => item.id !== ingredientId)

  const remainingRows = mealIngredientRows.value.filter(row => row.ingredientId !== ingredientId)
  mealIngredientRows.value = remainingRows.length > 0 ? remainingRows : [createMealIngredientRow()]
}

function initExistingMealMode(mealId: string) {
  const meal = meals.value.find(item => item.id === mealId)

  if (!meal) {
    pageMode.value = 'empty'
    pageError.value = 'Meal not found.'
    return
  }

  pageMode.value = 'edit'
  editingMealId.value = meal.id
  form.name = meal.name
  form.calories = String(meal.calories)
  form.protein = formatEditableQuantity(meal.protein)
  form.carbs = formatEditableQuantity(meal.carbs)
  form.fat = formatEditableQuantity(meal.fat)
  setFormDateTime(toLocalDateKey(new Date(meal.createdAt)), new Date(meal.createdAt))

  preservedManualSnapshots.value = [...meal.ingredients]

  const matchedRows = mapSnapshotsToIngredientRows(meal.ingredients)

  if (meal.ingredients.length > 0 && matchedRows.length === meal.ingredients.length) {
    form.entryMode = 'ingredients'
    mealIngredientRows.value = matchedRows
  } else {
    form.entryMode = 'manual'
    mealIngredientRows.value = [createMealIngredientRow()]
  }
}

function mapSnapshotsToIngredientRows(snapshots: MealIngredientSnapshot[]) {
  const rows: MealIngredientRow[] = []

  for (const snapshot of snapshots) {
    const match = allIngredients.value.find((ingredient) => {
      return ingredient.name.trim().toLocaleLowerCase() === snapshot.name.trim().toLocaleLowerCase()
        && ingredient.unit.trim().toLocaleLowerCase() === snapshot.unit.trim().toLocaleLowerCase()
    })

    if (!match) {
      return []
    }

    rows.push({
      id: createLocalId(),
      ingredientId: match.id,
      quantity: formatEditableQuantity(snapshot.amount)
    })
  }

  return rows
}

function resetForm() {
  form.name = ''
  form.calories = ''
  form.protein = ''
  form.carbs = ''
  form.fat = ''
  form.entryMode = 'manual'
  formDate.value = ''
  formTime.value = ''
  mealIngredientRows.value = [createMealIngredientRow()]
}

function setFormDateTime(dateKey: string, timeSource: Date) {
  formDate.value = /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : toLocalDateKey(new Date())
  formTime.value = formatTimeInput(timeSource)
}

function getQueryDateOrToday() {
  const queryDate = typeof route.query.date === 'string' ? route.query.date : ''
  return /^\d{4}-\d{2}-\d{2}$/.test(queryDate) ? queryDate : toLocalDateKey(new Date())
}

function parseImportedPayloadFromJson(jsonInput: string):
  | { ok: true, payload: ImportedMealPayload }
  | { ok: false, error: string } {
  const trimmed = jsonInput.trim()

  if (!trimmed) {
    return { ok: false, error: 'The import draft is empty.' }
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { ok: false, error: 'The import draft is not valid JSON.' }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Expected a JSON object with a matched_ingredients array.' }
  }

  const payload = parsed as Partial<ImportedMealPayload>

  if (!Array.isArray(payload.matched_ingredients)) {
    return { ok: false, error: 'Missing matched_ingredients array.' }
  }

  if (payload.new_ingredients !== undefined && !Array.isArray(payload.new_ingredients)) {
    return { ok: false, error: 'new_ingredients must be an array when provided.' }
  }

  return {
    ok: true,
    payload: {
      matched_ingredients: payload.matched_ingredients as ImportedMealMatch[],
      new_ingredients: payload.new_ingredients as ImportedNewIngredient[] | undefined
    }
  }
}

async function saveMeal() {
  formError.value = ''
  saveError.value = ''

  if (!isLoaded.value) {
    formError.value = 'Meal editor is still loading. Try again in a moment.'
    return
  }

  const name = form.name.trim()

  if (!name) {
    formError.value = 'Add a meal name.'
    return
  }

  const createdAt = parseDateTimeInput(formDate.value, formTime.value)

  if (!createdAt) {
    formError.value = 'Provide a valid date and time.'
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
    ingredientSnapshots = isEditingExistingMeal.value ? [...preservedManualSnapshots.value] : []
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
    const snapshots: MealIngredientSnapshot[] = []

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
      snapshots.push({
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
    ingredientSnapshots = snapshots
  }

  const nextMealId = isEditingExistingMeal.value
    ? (editingMealId.value as string)
    : createUuid()

  const nextMeal: MealEntry = {
    id: nextMealId,
    name,
    calories: Math.round(calories),
    protein: roundToOne(protein),
    carbs: roundToOne(carbs),
    fat: roundToOne(fat),
    ingredients: ingredientSnapshots,
    createdAt: createdAt.toISOString()
  }

  const nextMeals = isEditingExistingMeal.value
    ? meals.value.map(meal => meal.id === nextMeal.id ? nextMeal : meal)
    : [nextMeal, ...meals.value]

  const stagedIngredientsToPersist = pageMode.value === 'import'
    ? stagedImportedIngredients.value
    : []
  let nextBaseIngredients = baseIngredients.value

  if (stagedIngredientsToPersist.length > 0) {
    const existingUuids = new Set(baseIngredients.value.map(item => item.uuid))
    const deduped = stagedIngredientsToPersist.filter(item => !existingUuids.has(item.uuid))

    if (deduped.length > 0) {
      nextBaseIngredients = [...deduped, ...baseIngredients.value]
    }
  }

  isSaving.value = true

  try {
    if (nextBaseIngredients !== baseIngredients.value) {
      await writeIngredients(nextBaseIngredients)
      baseIngredients.value = nextBaseIngredients
    }

    await writeMeals(nextMeals)
    meals.value = nextMeals

    if (pageMode.value === 'import') {
      clearMealImportEditorDraft()
    }

    await navigateTo({
      path: '/meals',
      query: {
        date: formDate.value
      }
    })
  } catch (error) {
    console.error('Failed to save meal', error)
    saveError.value = 'Failed to save meal. Try again.'
  } finally {
    isSaving.value = false
  }
}

function cancelEditor() {
  void navigateTo({
    path: '/meals',
    query: {
      date: formDate.value || getQueryDateOrToday()
    }
  })
}

function parseDateTimeInput(dateValue: string, timeValue: string) {
  const trimmedDate = dateValue.trim()
  const trimmedTime = timeValue.trim()

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
    return null
  }

  if (!/^\d{2}:\d{2}$/.test(trimmedTime)) {
    return null
  }

  const parsed = new Date(`${trimmedDate}T${trimmedTime}:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function parseIngredientEditorForm(formState: IngredientEditorFormState):
  | {
    ok: true
    value: {
      name: string
      unit: string
      portionSize: number
      kcal: number
      protein: number
      carbs: number
      fat: number
    }
  }
  | {
    ok: false
    error: string
  } {
  const name = formState.name.trim()
  const unit = formState.unit.trim()
  const portionSize = Number(formState.portionSize)
  const kcal = Number(formState.kcal)
  const protein = Number(formState.protein)
  const carbs = Number(formState.carbs)
  const fat = Number(formState.fat)

  if (!name) {
    return { ok: false, error: 'Ingredient name is required.' }
  }

  if (!unit) {
    return { ok: false, error: 'Unit is required.' }
  }

  if (!Number.isFinite(portionSize) || portionSize <= 0) {
    return { ok: false, error: 'Portion size must be greater than 0.' }
  }

  if (![kcal, protein, carbs, fat].every(value => Number.isFinite(value) && value >= 0)) {
    return { ok: false, error: 'Calories and macros must be zero or positive numbers.' }
  }

  return {
    ok: true,
    value: {
      name,
      unit,
      portionSize,
      kcal: Math.round(kcal),
      protein: roundToOne(protein),
      carbs: roundToOne(carbs),
      fat: roundToOne(fat)
    }
  }
}

function formatTimeInput(date: Date) {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function formatEditableQuantity(value: number) {
  if (!Number.isFinite(value)) {
    return ''
  }

  const rounded = roundToThree(value)
  return Number.isInteger(rounded) ? String(rounded) : String(rounded)
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

function toLocalDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function createMealIngredientRow(): MealIngredientRow {
  return {
    id: createLocalId(),
    ingredientId: '',
    quantity: '1'
  }
}

function createLocalId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createIngredientLocalId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createUuid() {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  const bytes = new Uint8Array(16)

  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80

  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function createImportedIngredient(value: Partial<ImportedNewIngredient>): IngredientReference | null {
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  const unit = typeof value.unit === 'string' ? value.unit.trim() : ''
  const portionSize = value.portion_size
  const calories = value.calories
  const proteinValue = value.proteins ?? value.protein
  const carbs = value.carbs
  const fat = value.fat

  if (!name || !unit) {
    return null
  }

  if (
    typeof portionSize !== 'number'
    || !Number.isFinite(portionSize)
    || portionSize <= 0
    || typeof calories !== 'number'
    || !Number.isFinite(calories)
    || calories < 0
    || typeof proteinValue !== 'number'
    || !Number.isFinite(proteinValue)
    || proteinValue < 0
    || typeof carbs !== 'number'
    || !Number.isFinite(carbs)
    || carbs < 0
    || typeof fat !== 'number'
    || !Number.isFinite(fat)
    || fat < 0
  ) {
    return null
  }

  return {
    id: createIngredientLocalId(),
    uuid: createUuid(),
    name,
    unit,
    portionSize,
    kcal: Math.round(calories),
    protein: roundToOne(proteinValue),
    carbs: roundToOne(carbs),
    fat: roundToOne(fat),
    kcalPerUnit: roundToSix(calories / portionSize),
    proteinPerUnit: roundToSix(proteinValue / portionSize),
    carbsPerUnit: roundToSix(carbs / portionSize),
    fatPerUnit: roundToSix(fat / portionSize),
    createdAt: new Date().toISOString()
  }
}

async function loadMealsFromDb(): Promise<MealEntry[]> {
  try {
    return await readMeals()
  } catch (error) {
    console.error('Failed to read meals from IndexedDB', error)
    return []
  }
}

async function loadIngredientsFromDb(): Promise<IngredientReference[]> {
  try {
    return await readIngredients()
  } catch (error) {
    console.error('Failed to read ingredients from IndexedDB', error)
    return []
  }
}
</script>

<template>
  <div class="flex w-full max-w-5xl flex-col gap-6">
    <header class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div class="flex flex-wrap items-center gap-2">
          <h1 class="text-2xl font-semibold tracking-tight text-highlighted sm:text-3xl">
            {{ pageTitle }}
          </h1>
          <UBadge
            v-if="pageMode === 'import' && importSource === 'ai'"
            color="primary"
            variant="soft"
          >
            AI prefilled
          </UBadge>
        </div>
        <p class="text-sm text-muted">
          {{ pageDescription }}
        </p>
      </div>

      <div class="flex w-full items-center justify-end gap-2 sm:w-auto">
        <UButton
          type="button"
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-left"
          class="w-full justify-center sm:w-auto"
          @click="cancelEditor"
        >
          Back to meals
        </UButton>
      </div>
    </header>

    <UCard v-if="!isLoaded">
      <div class="rounded-lg border border-dashed border-default px-4 py-8 text-center text-sm text-muted">
        Loading meal editor...
      </div>
    </UCard>

    <UCard v-else-if="pageMode === 'empty'">
      <div class="space-y-4">
        <p class="text-sm text-error">
          {{ pageError || 'Unable to open the meal editor.' }}
        </p>
        <div class="flex justify-end">
          <UButton
            type="button"
            color="neutral"
            variant="soft"
            @click="cancelEditor"
          >
            Back to meals
          </UButton>
        </div>
      </div>
    </UCard>

    <UCard v-else>
      <div class="space-y-4">
        <div>
          <h2 class="text-lg font-semibold text-highlighted">
            {{ isEditingExistingMeal ? 'Meal details' : 'Create meal' }}
          </h2>
          <p class="text-sm text-muted">
            Use manual totals or compose from saved ingredients. In ingredient mode, the meal totals are calculated automatically.
          </p>
        </div>

        <form
          class="space-y-4"
          @submit.prevent="saveMeal"
        >
          <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_170px_150px]">
            <div class="space-y-2">
              <label
                for="meal-editor-name"
                class="block text-sm font-medium text-highlighted"
              >
                Meal name
              </label>
              <UInput
                id="meal-editor-name"
                v-model="form.name"
                placeholder="e.g. Ham sandwich"
                size="lg"
              />
            </div>

            <div class="space-y-2">
              <label
                for="meal-editor-date"
                class="block text-sm font-medium text-highlighted"
              >
                Date
              </label>
              <UInput
                id="meal-editor-date"
                v-model="formDate"
                type="date"
                size="lg"
              />
            </div>

            <div class="space-y-2">
              <label
                for="meal-editor-time"
                class="block text-sm font-medium text-highlighted"
              >
                Time
              </label>
              <UInput
                id="meal-editor-time"
                v-model="formTime"
                type="time"
                size="lg"
              />
            </div>
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
            v-if="pageMode === 'import' && stagedImportedIngredients.length > 0"
            class="space-y-3 rounded-xl border border-default bg-muted/10 p-4"
          >
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="text-sm font-medium text-highlighted">
                  New ingredients ({{ stagedImportedIngredients.length }})
                </p>
                <p class="text-xs text-muted">
                  These were suggested by the import. Review and edit them before saving. They will only be created when you click
                  <span class="font-medium text-highlighted">{{ submitButtonLabel }}</span>.
                </p>
              </div>
            </div>

            <div class="space-y-3">
              <div
                v-for="ingredient in stagedImportedIngredients"
                :key="ingredient.id"
                class="rounded-lg border border-default bg-default p-3"
              >
                <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div class="min-w-0 space-y-2">
                    <p class="truncate text-sm font-semibold text-highlighted">
                      {{ ingredient.name }}
                    </p>

                    <div class="flex flex-wrap gap-2">
                      <UBadge
                        color="neutral"
                        variant="outline"
                        size="sm"
                      >
                        Portion: {{ formatIngredientPortionSummary(ingredient) }}
                      </UBadge>
                      <UBadge
                        color="neutral"
                        variant="soft"
                        size="sm"
                      >
                        {{ formatDensity(ingredient.kcalPerUnit) }} kcal/{{ ingredient.unit }}
                      </UBadge>
                    </div>

                    <div class="flex flex-wrap gap-2">
                      <UBadge
                        color="neutral"
                        variant="soft"
                        size="sm"
                        :style="MACRO_COLORS.protein.badgeStyle"
                      >
                        P: {{ formatMacro(ingredient.protein) }}g
                      </UBadge>
                      <UBadge
                        color="neutral"
                        variant="soft"
                        size="sm"
                        :style="MACRO_COLORS.carbs.badgeStyle"
                      >
                        C: {{ formatMacro(ingredient.carbs) }}g
                      </UBadge>
                      <UBadge
                        color="neutral"
                        variant="soft"
                        size="sm"
                        :style="MACRO_COLORS.fat.badgeStyle"
                      >
                        F: {{ formatMacro(ingredient.fat) }}g
                      </UBadge>
                      <UBadge
                        color="neutral"
                        variant="soft"
                        size="sm"
                      >
                        {{ ingredient.kcal.toLocaleString() }} kcal / portion
                      </UBadge>
                    </div>
                  </div>

                  <div class="flex shrink-0 items-center gap-2 self-end sm:self-start">
                    <UButton
                      type="button"
                      color="neutral"
                      variant="soft"
                      size="sm"
                      icon="i-lucide-pencil"
                      @click="openStagedIngredientEditor(ingredient.id)"
                    >
                      Edit
                    </UButton>
                    <UButton
                      type="button"
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      icon="i-lucide-trash-2"
                      @click="removeStagedIngredient(ingredient.id)"
                    >
                      Remove
                    </UButton>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            v-if="form.entryMode === 'manual'"
            class="space-y-3"
          >
            <div class="space-y-2">
              <label
                for="meal-editor-calories"
                class="block text-sm font-medium text-highlighted"
              >
                Calories
              </label>
              <UInput
                id="meal-editor-calories"
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
                  for="meal-editor-protein"
                  class="block text-xs font-medium text-muted"
                >
                  Protein (g)
                </label>
                <UInput
                  id="meal-editor-protein"
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
                  for="meal-editor-carbs"
                  class="block text-xs font-medium text-muted"
                >
                  Carbs (g)
                </label>
                <UInput
                  id="meal-editor-carbs"
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
                  for="meal-editor-fat"
                  class="block text-xs font-medium text-muted"
                >
                  Fat (g)
                </label>
                <UInput
                  id="meal-editor-fat"
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
              <template v-if="isEditingExistingMeal && preservedManualSnapshots.length > 0">
                Existing ingredient breakdown will be kept unless you switch to ingredient mode.
              </template>
            </p>
          </div>

          <div
            v-else
            class="space-y-4"
          >
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-sm font-medium text-highlighted">
                  Ingredients
                </p>
                <p class="text-xs text-muted">
                  Select ingredients and quantities. You can type while the selector is focused to jump/search.
                </p>
              </div>
              <UButton
                type="button"
                color="neutral"
                variant="soft"
                size="sm"
                icon="i-lucide-plus"
                @click="addMealIngredientRow"
              >
                Add row
              </UButton>
            </div>

            <div
              v-if="!hasIngredients"
              class="rounded-lg border border-dashed border-default px-4 py-8 text-center"
            >
              <p class="text-sm font-medium text-highlighted">
                No ingredients available
              </p>
              <p class="mt-1 text-sm text-muted">
                Create ingredients first, then return here to compose meals from them.
              </p>
              <div class="mt-4 flex justify-center">
                <UButton
                  to="/ingredients"
                  color="neutral"
                  variant="soft"
                  icon="i-lucide-carrot"
                >
                  Open ingredients
                </UButton>
              </div>
            </div>

            <div
              v-else
              class="space-y-3"
            >
              <div
                v-for="(row, rowIndex) in mealIngredientRows"
                :key="row.id"
                class="grid gap-3 rounded-xl border border-default p-3 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-end"
              >
                <div class="space-y-2">
                  <label
                    :for="`meal-editor-ingredient-${row.id}`"
                    class="block text-xs font-medium text-muted"
                  >
                    Ingredient {{ rowIndex + 1 }}
                  </label>
                  <USelect
                    :id="`meal-editor-ingredient-${row.id}`"
                    v-model="row.ingredientId"
                    :items="ingredientSelectOptions"
                    placeholder="Select an ingredient"
                    class="w-full"
                  />
                </div>

                <div class="space-y-2">
                  <label
                    :for="`meal-editor-qty-${row.id}`"
                    class="block text-xs font-medium text-muted"
                  >
                    {{ quantityLabelForRow(row) }}
                  </label>
                  <QuantityInput
                    :id="`meal-editor-qty-${row.id}`"
                    v-model="row.quantity"
                    :min="0"
                    :step="1"
                    placeholder="1"
                  />
                </div>

                <div class="flex justify-stretch md:justify-start">
                  <UButton
                    type="button"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    class="w-full justify-center md:w-auto"
                    @click="removeMealIngredientRow(row.id)"
                  >
                    Remove
                  </UButton>
                </div>
              </div>

              <div class="rounded-xl border border-default bg-muted/10 p-4">
                <div class="flex items-start justify-between gap-4">
                  <div>
                    <p class="text-sm font-medium text-highlighted">
                      Calculated totals
                    </p>
                    <p class="text-xs text-muted">
                      Totals update from the selected ingredients and quantities.
                    </p>
                  </div>
                  <UBadge
                    color="neutral"
                    variant="soft"
                  >
                    {{ Math.round(composedTotals.calories) }} kcal
                  </UBadge>
                </div>

                <div class="mt-3 flex flex-wrap gap-2">
                  <UBadge
                    color="neutral"
                    variant="soft"
                    size="sm"
                    :style="MACRO_COLORS.protein.badgeStyle"
                  >
                    P: {{ formatMacro(composedTotals.protein) }}g
                  </UBadge>
                  <UBadge
                    color="neutral"
                    variant="soft"
                    size="sm"
                    :style="MACRO_COLORS.carbs.badgeStyle"
                  >
                    C: {{ formatMacro(composedTotals.carbs) }}g
                  </UBadge>
                  <UBadge
                    color="neutral"
                    variant="soft"
                    size="sm"
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

          <p
            v-else-if="saveError"
            class="text-sm text-error"
          >
            {{ saveError }}
          </p>

          <div class="flex flex-col-reverse items-end gap-2 sm:flex-row sm:justify-end">
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              :disabled="isSaving"
              @click="cancelEditor"
            >
              Cancel
            </UButton>
            <UButton
              type="submit"
              icon="i-lucide-save"
              :loading="isSaving"
            >
              {{ submitButtonLabel }}
            </UButton>
          </div>
        </form>
      </div>
    </UCard>

    <IngredientEditorModal
      v-model:open="isStagedIngredientEditorOpen"
      mode="edit"
      :form="stagedIngredientEditorForm"
      :error="stagedIngredientEditorError"
      @cancel="closeStagedIngredientEditor"
      @submit="saveStagedIngredientEdits"
    />
  </div>
</template>
