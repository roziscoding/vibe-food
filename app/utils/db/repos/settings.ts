import { readClientValue, writeClientValue } from '../../client-db'

export interface AppSettings {
  dailyCalorieGoal: number
  proteinGoal: number
  carbsGoal: number
  fatGoal: number
}

export const DEFAULT_DAILY_CALORIE_GOAL = 2000
export const DEFAULT_PROTEIN_GOAL = 150
export const DEFAULT_CARBS_GOAL = 250
export const DEFAULT_FAT_GOAL = 70

const SETTINGS_KEY = 'settings'

export async function readAppSettings(): Promise<AppSettings> {
  const value = await readClientValue<unknown>(SETTINGS_KEY)
  return normalizeAppSettings(value)
}

export async function writeAppSettings(settings: AppSettings): Promise<void> {
  await writeClientValue(SETTINGS_KEY, normalizeAppSettings(settings))
}

export function normalizeAppSettings(value: unknown): AppSettings {
  if (!value || typeof value !== 'object') {
    return {
      dailyCalorieGoal: DEFAULT_DAILY_CALORIE_GOAL,
      proteinGoal: DEFAULT_PROTEIN_GOAL,
      carbsGoal: DEFAULT_CARBS_GOAL,
      fatGoal: DEFAULT_FAT_GOAL
    }
  }

  const settings = value as Partial<AppSettings>
  const dailyCalorieGoal = normalizePositiveInt(settings.dailyCalorieGoal, DEFAULT_DAILY_CALORIE_GOAL)
  const proteinGoal = normalizePositiveInt(settings.proteinGoal, DEFAULT_PROTEIN_GOAL)
  const carbsGoal = normalizePositiveInt(settings.carbsGoal, DEFAULT_CARBS_GOAL)
  const fatGoal = normalizePositiveInt(settings.fatGoal, DEFAULT_FAT_GOAL)

  return {
    dailyCalorieGoal,
    proteinGoal,
    carbsGoal,
    fatGoal
  }
}

function normalizePositiveInt(value: unknown, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback
  }

  return Math.round(value)
}
