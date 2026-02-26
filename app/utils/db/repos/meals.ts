import { readClientCollection, writeClientCollection } from '../../client-db'

const MEALS_COLLECTION_KEY = 'meals'

export interface MealIngredientSnapshotRecord {
  name: string
  amount: number
  unit: string
}

export interface MealRecord {
  id: string
  name: string
  calories: number
  protein: number
  carbs: number
  fat: number
  ingredients: MealIngredientSnapshotRecord[]
  createdAt: string
}

export async function readMeals(): Promise<MealRecord[]> {
  const parsed = await readClientCollection<unknown>(MEALS_COLLECTION_KEY)
  return parsed.flatMap(normalizeMealRecord)
}

export async function writeMeals(value: MealRecord[]): Promise<void> {
  await writeClientCollection(MEALS_COLLECTION_KEY, value)
}

export function normalizeMealRecord(value: unknown): MealRecord[] {
  if (!value || typeof value !== 'object') {
    return []
  }

  const meal = value as Partial<MealRecord>

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
    ? meal.ingredients.flatMap(normalizeMealIngredientSnapshotRecord)
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

export function normalizeMealIngredientSnapshotRecord(value: unknown): MealIngredientSnapshotRecord[] {
  if (!value || typeof value !== 'object') {
    return []
  }

  const item = value as Partial<MealIngredientSnapshotRecord>

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

function roundToOne(value: number) {
  return Math.round(value * 10) / 10
}

function roundToThree(value: number) {
  return Math.round(value * 1_000) / 1_000
}
