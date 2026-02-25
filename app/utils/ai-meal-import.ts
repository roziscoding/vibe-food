import type { AiProvider } from './client-settings'

export interface AiMealImportIngredient {
  ingredient_id: string
  name: string
  unit: string
  kcal_per_unit: number
  protein_per_unit_g: number
  carbs_per_unit_g: number
  fat_per_unit_g: number
}

export interface AiGeneratedMealPayload {
  meal_name?: string
  matched_ingredients: Array<{
    ingredient_id: string
    amount: number
  }>
  new_ingredients?: Array<{
    name: string
    unit: string
    portion_size: number
    calories: number
    carbs: number
    proteins?: number
    fat: number
  }>
}

type GenerateAiMealImportPayloadInput = {
  provider: AiProvider
  apiKey: string
  mealName?: string
  mealDescription: string
  ingredients: AiMealImportIngredient[]
}

type TestAiProviderKeyInput = {
  provider: AiProvider
  apiKey: string
}

const OPENAI_MODEL = 'gpt-4.1-mini'
const ANTHROPIC_MODEL = 'claude-3-5-haiku-latest'

export async function testAiProviderKey(input: TestAiProviderKeyInput): Promise<void> {
  const apiKey = input.apiKey.trim()

  if (!apiKey) {
    throw new Error('API key is required.')
  }

  if (input.provider === 'openai') {
    await requestOpenAiJson({
      apiKey,
      systemPrompt: 'Return JSON only with {"ok": true}.',
      userPrompt: 'Ping'
    })
    return
  }

  await requestAnthropicJson({
    apiKey,
    systemPrompt: 'Reply with the single word OK.',
    userPrompt: 'Ping'
  })
}

export async function generateAiMealImportPayload(
  input: GenerateAiMealImportPayloadInput
): Promise<AiGeneratedMealPayload> {
  const apiKey = input.apiKey.trim()

  if (!apiKey) {
    throw new Error('Missing API key.')
  }

  const outputSchemaPrompt = {
    meal_name: {
      type: 'string',
      description: 'Final meal name. If meal_name was provided in the input, copy it exactly. Otherwise, suggest a concise descriptive meal name in the same language as the ingredient list/description.'
    },
    matched_ingredients: {
      type: 'array',
      description: 'List of ingredients matched between the meal description and available inventory',
      items: {
        type: 'object',
        properties: {
          ingredient_id: {
            type: 'string',
            description: 'The unique identifier of the ingredient from the available list'
          },
          amount: {
            type: 'number',
            description: 'The quantity of the ingredient, converted to the matched ingredient unit when needed'
          }
        }
      }
    },
    new_ingredients: {
      type: 'array',
      optional: false,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the new ingredient' },
          unit: { type: 'string', description: 'Unit of measure for the new ingredient' },
          portion_size: { type: 'number', description: 'Portion size in the same unit used in the unit field' },
          calories: { type: 'number', description: 'Calories per portion in kcal' },
          carbs: { type: 'number', description: 'Carbs per portion in grams' },
          proteins: { type: 'number', description: 'Protein per portion in grams' },
          fat: { type: 'number', description: 'Fat per portion in grams' }
        }
      }
    }
  }

  const systemPrompt = [
    'Objective',
    '',
    'Your task is to analyze a meal description containing ingredients and amounts, and match them against a provided list of available ingredients. For each matched item, return the specific ingredient_id from the available list and the quantity specified in the meal description.',
    '',
    'Instructions',
    '1. Read the text provided in meal_description to identify the ingredients used and their respective quantities.',
    '2. Review the list of ingredients in available_ingredients_list. Each item has a unique ingredient_id, unit, and per-unit nutrition values.',
    '3. If meal_name is provided and non-empty, copy it exactly into the output field meal_name. If it is missing or empty, generate a concise descriptive meal_name in the same language as the ingredient list/description.',
    '4. Match the ingredients found in the meal description to the most appropriate item in the available ingredients list based on semantic similarity.',
    '5. Extract the amount associated with that ingredient from the meal description.',
    '6. When the unit in the meal description does not match the unit in the available ingredient, convert the amount to the available ingredient unit and output the converted amount.',
    '7. Output JSON only (no markdown fences, no explanation) using the schema below.',
    '',
    'Observations',
    '- If an ingredient in the meal description cannot be confidently matched to the available list, add it to new_ingredients instead of guessing.',
    '- For new_ingredients, estimate nutrition values (calories, carbs, proteins, fat) as accurately as possible using common nutrition knowledge.',
    '- New ingredient names must match the language used by the existing ingredient list.',
    '- Use Title Case for meal_name and new_ingredients names (while keeping the same language).',
    '- Use non-negative numbers only.',
    '- If no new ingredients are needed, you may omit new_ingredients or return an empty array.',
    '- Always include a non-empty meal_name in the output JSON.',
    '- Keep meal_name short and natural. Do not list all ingredients in the name (e.g. prefer "Egg sandwich" instead of "Egg sandwich with mayo, cheese, and ham").',
    '',
    'Output schema',
    JSON.stringify(outputSchemaPrompt, null, 2)
  ].join('\n')

  const userPrompt = JSON.stringify({
    meal_name: input.mealName?.trim() || null,
    meal_description: input.mealDescription.trim(),
    available_ingredients_list: input.ingredients
  }, null, 2)

  const rawText = input.provider === 'openai'
    ? await requestOpenAiJson({ apiKey, systemPrompt, userPrompt })
    : await requestAnthropicJson({ apiKey, systemPrompt, userPrompt })

  const parsed = parseJsonFromModelText(rawText)
  const normalized = normalizeAiGeneratedMealPayload(parsed, {
    requestedMealName: input.mealName?.trim() || ''
  })
  validateAiGeneratedMealPayload(normalized)
  return normalized
}

async function requestOpenAiJson(input: {
  apiKey: string
  systemPrompt: string
  userPrompt: string
}) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.apiKey}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: input.userPrompt }
      ]
    })
  })

  if (!response.ok) {
    const errorText = await safeReadText(response)
    throw new Error(`OpenAI request failed (${response.status}): ${truncate(errorText)}`)
  }

  const data = await response.json() as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string, text?: string }>
      }
    }>
  }

  const content = data.choices?.[0]?.message?.content

  if (typeof content === 'string' && content.trim()) {
    return content
  }

  if (Array.isArray(content)) {
    const text = content
      .map(part => typeof part?.text === 'string' ? part.text : '')
      .join('\n')
      .trim()

    if (text) {
      return text
    }
  }

  throw new Error('OpenAI response did not contain a usable message.')
}

async function requestAnthropicJson(input: {
  apiKey: string
  systemPrompt: string
  userPrompt: string
}) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': input.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1200,
      temperature: 0.2,
      system: input.systemPrompt,
      messages: [
        {
          role: 'user',
          content: input.userPrompt
        }
      ]
    })
  })

  if (!response.ok) {
    const errorText = await safeReadText(response)
    throw new Error(`Anthropic request failed (${response.status}): ${truncate(errorText)}`)
  }

  const data = await response.json() as {
    content?: Array<{ type?: string, text?: string }>
  }

  const text = (data.content ?? [])
    .map(block => typeof block.text === 'string' ? block.text : '')
    .join('\n')
    .trim()

  if (!text) {
    throw new Error('Anthropic response did not contain text.')
  }

  return text
}

function parseJsonFromModelText(text: string): AiGeneratedMealPayload {
  const normalized = stripCodeFences(text)

  try {
    return JSON.parse(normalized) as AiGeneratedMealPayload
  }
  catch {
    const start = normalized.indexOf('{')
    const end = normalized.lastIndexOf('}')

    if (start >= 0 && end > start) {
      return JSON.parse(normalized.slice(start, end + 1)) as AiGeneratedMealPayload
    }

    throw new Error('Model response was not valid JSON.')
  }
}

function stripCodeFences(value: string) {
  const trimmed = value.trim()
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fencedMatch?.[1]?.trim() ?? trimmed
}

function normalizeAiGeneratedMealPayload(
  payload: AiGeneratedMealPayload,
  input: { requestedMealName: string }
): AiGeneratedMealPayload {
  const nextPayload: AiGeneratedMealPayload = {
    ...payload,
    matched_ingredients: Array.isArray(payload.matched_ingredients)
      ? payload.matched_ingredients.map(item => ({ ...item }))
      : []
  }

  if (Array.isArray(payload.new_ingredients)) {
    nextPayload.new_ingredients = payload.new_ingredients.map((ingredient) => {
      const nextIngredient = { ...ingredient }

      if (typeof nextIngredient.name === 'string') {
        nextIngredient.name = toTitleCaseName(nextIngredient.name)
      }

      return nextIngredient
    })
  }

  if (input.requestedMealName) {
    nextPayload.meal_name = input.requestedMealName
  }
  else if (typeof nextPayload.meal_name === 'string') {
    nextPayload.meal_name = normalizeSuggestedMealName(nextPayload.meal_name)
  }

  return nextPayload
}

function normalizeSuggestedMealName(value: string) {
  const collapsed = value.trim().replace(/\s+/g, ' ')
  const withoutTrailingWithClause = collapsed.replace(/\s+with\s+.+$/i, '')
  return toTitleCaseName(withoutTrailingWithClause || collapsed)
}

function toTitleCaseName(value: string) {
  const collapsed = value.trim().replace(/\s+/g, ' ')

  if (!collapsed) {
    return ''
  }

  return collapsed
    .split(' ')
    .map(token => titleCaseToken(token))
    .join(' ')
}

function titleCaseToken(token: string) {
  const pieces = token.split(/([-/'’()])/g)

  return pieces.map((piece) => {
    if (!piece || /^[-/'’()]$/.test(piece)) {
      return piece
    }

    const lower = piece.toLocaleLowerCase()
    return `${lower.slice(0, 1).toLocaleUpperCase()}${lower.slice(1)}`
  }).join('')
}

function validateAiGeneratedMealPayload(value: unknown): asserts value is AiGeneratedMealPayload {
  if (!value || typeof value !== 'object') {
    throw new Error('Expected a JSON object.')
  }

  const payload = value as {
    meal_name?: unknown
    matched_ingredients?: unknown
    new_ingredients?: unknown
  }

  if (payload.meal_name !== undefined) {
    if (typeof payload.meal_name !== 'string' || payload.meal_name.trim().length === 0) {
      throw new Error('meal_name must be a non-empty string when provided.')
    }
  }

  if (!Array.isArray(payload.matched_ingredients)) {
    throw new Error('Missing matched_ingredients array.')
  }

  for (const item of payload.matched_ingredients) {
    if (!item || typeof item !== 'object') {
      throw new Error('Each matched_ingredients entry must be an object.')
    }

    const match = item as { ingredient_id?: unknown, amount?: unknown }

    if (typeof match.ingredient_id !== 'string' || !match.ingredient_id.trim()) {
      throw new Error('Each matched_ingredients entry must include ingredient_id.')
    }

    if (typeof match.amount !== 'number' || !Number.isFinite(match.amount) || match.amount <= 0) {
      throw new Error('Each matched_ingredients entry must include amount > 0.')
    }
  }

  if (payload.new_ingredients === undefined) {
    return
  }

  if (!Array.isArray(payload.new_ingredients)) {
    throw new Error('new_ingredients must be an array when provided.')
  }

  for (const item of payload.new_ingredients) {
    if (!item || typeof item !== 'object') {
      throw new Error('Each new_ingredients entry must be an object.')
    }
  }
}

async function safeReadText(response: Response) {
  try {
    return await response.text()
  }
  catch {
    return ''
  }
}

function truncate(value: string, max = 240) {
  const trimmed = value.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= max) {
    return trimmed || 'No response body'
  }

  return `${trimmed.slice(0, max - 1)}…`
}
