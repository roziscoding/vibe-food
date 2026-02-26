import { readClientCollection, writeClientCollection } from '../../client-db'

const INGREDIENTS_COLLECTION_KEY = 'ingredients'

export interface IngredientRecord {
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

export async function readIngredients(): Promise<IngredientRecord[]> {
  const parsed = await readClientCollection<unknown>(INGREDIENTS_COLLECTION_KEY)
  return parsed.flatMap(normalizeIngredientRecord)
}

export async function writeIngredients(value: IngredientRecord[]): Promise<void> {
  await writeClientCollection(INGREDIENTS_COLLECTION_KEY, value)
}

export function normalizeIngredientRecord(value: unknown): IngredientRecord[] {
  if (!value || typeof value !== 'object') {
    return []
  }

  const ingredient = value as Partial<IngredientRecord>

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

function roundToOne(value: number) {
  return Math.round(value * 10) / 10
}

function roundToThree(value: number) {
  return Math.round(value * 1_000) / 1_000
}

function roundToSix(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000
}
