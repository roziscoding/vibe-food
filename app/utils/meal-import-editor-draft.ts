export type MealImportEditorDraftSource = 'ai' | 'manual'

export type MealImportEditorDraft = {
  mealName: string
  json: string
  targetDateKey?: string
  source?: MealImportEditorDraftSource
  updatedAt: string
}

const MEAL_IMPORT_EDITOR_DRAFT_KEY = 'vibe-food:meal-import-editor-draft'

export function readMealImportEditorDraft(): MealImportEditorDraft | null {
  if (typeof window === 'undefined') {
    return null
  }

  const rawValue = window.sessionStorage.getItem(MEAL_IMPORT_EDITOR_DRAFT_KEY)

  if (!rawValue) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<MealImportEditorDraft>

    if (typeof parsed.mealName !== 'string' || typeof parsed.json !== 'string') {
      return null
    }

    const targetDateKey = typeof parsed.targetDateKey === 'string' ? parsed.targetDateKey.trim() : undefined
    const source = parsed.source === 'ai' || parsed.source === 'manual' ? parsed.source : undefined

    return {
      mealName: parsed.mealName,
      json: parsed.json,
      targetDateKey: targetDateKey || undefined,
      source,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString()
    }
  }
  catch {
    return null
  }
}

export function writeMealImportEditorDraft(input: Omit<MealImportEditorDraft, 'updatedAt'>) {
  if (typeof window === 'undefined') {
    return
  }

  const payload: MealImportEditorDraft = {
    mealName: input.mealName,
    json: input.json,
    targetDateKey: input.targetDateKey,
    source: input.source,
    updatedAt: new Date().toISOString()
  }

  window.sessionStorage.setItem(MEAL_IMPORT_EDITOR_DRAFT_KEY, JSON.stringify(payload))
}

export function clearMealImportEditorDraft() {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.removeItem(MEAL_IMPORT_EDITOR_DRAFT_KEY)
}
