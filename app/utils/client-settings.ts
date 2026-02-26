import {
  readAppSettings as readAppSettingsFromRepo,
  writeAppSettings as writeAppSettingsToRepo
} from './db/repos/settings'
import type { AppSettings } from './db/repos/settings'

export {
  DEFAULT_CARBS_GOAL,
  DEFAULT_DAILY_CALORIE_GOAL,
  DEFAULT_FAT_GOAL,
  DEFAULT_PROTEIN_GOAL
} from './db/repos/settings'
export type { AppSettings } from './db/repos/settings'

export type AiProvider = 'openai' | 'anthropic'
export const DEFAULT_AI_PROVIDER: AiProvider = 'openai'

export async function readAppSettings(): Promise<AppSettings> {
  return readAppSettingsFromRepo()
}

export async function writeAppSettings(settings: AppSettings): Promise<void> {
  await writeAppSettingsToRepo(settings)
}
