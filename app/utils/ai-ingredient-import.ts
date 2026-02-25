import type { AiProvider } from './client-settings'

export type AiExtractedIngredientPayload = {
  product_name: string
  calories: number
  portion_size: number
  portion_unit: string
  macros_per_portion: {
    protein_g: number
    carbohydrates_g: number
    total_fat_g: number
  }
}

type ExtractIngredientFromNutritionLabelImageInput = {
  provider: AiProvider
  apiKey: string
  imageDataUrl: string
}

const OPENAI_MODEL = 'gpt-4.1-mini'
const ANTHROPIC_MODEL = 'claude-3-5-haiku-latest'

export async function extractIngredientFromNutritionLabelImage(
  input: ExtractIngredientFromNutritionLabelImageInput
): Promise<AiExtractedIngredientPayload> {
  const apiKey = input.apiKey.trim()

  if (!apiKey) {
    throw new Error('Missing API key.')
  }

  const { mimeType, base64Data } = parseDataUrlImage(input.imageDataUrl)

  const outputSchema = {
    product_name: {
      type: 'string',
      description: 'Name of the product or ingredient found in the image, or "-" if not found.'
    },
    calories: {
      type: 'number',
      description: 'Total calories per serving.'
    },
    portion_size: {
      type: 'number',
      description: 'Numeric value of the serving size.'
    },
    portion_unit: {
      type: 'string',
      description: 'Unit of measurement for the serving size (e.g., "g", "ml").'
    },
    macros_per_portion: {
      type: 'object',
      description: 'Object containing macronutrients in grams.',
      properties: {
        protein_g: {
          type: 'number',
          description: 'Amount of protein in grams per serving.'
        },
        carbohydrates_g: {
          type: 'number',
          description: 'Amount of total carbohydrates in grams per serving.'
        },
        total_fat_g: {
          type: 'number',
          description: 'Amount of total fat in grams per serving.'
        }
      }
    }
  }

  const systemPrompt = [
    'Objective',
    '',
    'Extract nutritional information from the provided image of a nutrition facts label. Identify the product name (if visible), serving size information, calories, and specific macronutrients per serving.',
    '',
    'Instructions',
    '1. Analyze the image provided in nutrition_table_image.',
    '2. Extract the following information:',
    '- Product Name: Look for the name of the ingredient or product. If not explicitly present in the image, return "-".',
    '- Calories: Total energy/calories per serving.',
    '- Portion Size: The numeric value of the serving size (e.g., 30).',
    '- Portion Unit: The unit of measurement for the serving size (e.g., g, ml, tbsp).',
    '- Macronutrients: Extract the values (in grams) per portion for Protein, Total Carbohydrates, and Total Fat.',
    '3. Output JSON only (no markdown fences, no explanation) using the schema below.',
    '',
    'Observations',
    '- Ensure all macronutrient values are strictly numbers representing grams. If a value is missing or zero, treat it as 0 unless specified otherwise.',
    '- If the portion size is given in household measures (e.g., "1 scoop"), try to find the corresponding gram/milliliter weight usually listed in parentheses (e.g., "30g"). Use the weight as priority.',
    '- Use Title Case for product_name when a name is present.',
    '',
    'Output format',
    JSON.stringify(outputSchema, null, 2)
  ].join('\n')

  const userPrompt = JSON.stringify({
    nutrition_table_image: 'attached_image'
  }, null, 2)

  const rawText = input.provider === 'openai'
    ? await requestOpenAiJsonWithImage({
        apiKey,
        systemPrompt,
        userPrompt,
        imageDataUrl: input.imageDataUrl
      })
    : await requestAnthropicJsonWithImage({
        apiKey,
        systemPrompt,
        userPrompt,
        mimeType,
        base64Data
      })

  const parsed = parseJsonFromModelText(rawText)
  const normalized = normalizeExtractedIngredientPayload(parsed)
  validateExtractedIngredientPayload(normalized)
  return normalized
}

async function requestOpenAiJsonWithImage(input: {
  apiKey: string
  systemPrompt: string
  userPrompt: string
  imageDataUrl: string
}) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${input.apiKey}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: input.systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: input.userPrompt },
            {
              type: 'image_url',
              image_url: {
                url: input.imageDataUrl
              }
            }
          ]
        }
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

async function requestAnthropicJsonWithImage(input: {
  apiKey: string
  systemPrompt: string
  userPrompt: string
  mimeType: string
  base64Data: string
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
      temperature: 0.1,
      system: input.systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: input.userPrompt
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: input.mimeType,
                data: input.base64Data
              }
            }
          ]
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

function parseDataUrlImage(value: string) {
  const trimmed = value.trim()
  const match = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/)

  if (!match || typeof match[1] !== 'string' || typeof match[2] !== 'string') {
    throw new Error('Invalid image data. Select a valid image file and try again.')
  }

  return {
    mimeType: match[1],
    base64Data: match[2]
  }
}

function parseJsonFromModelText(text: string): unknown {
  const normalized = stripCodeFences(text)

  try {
    return JSON.parse(normalized) as unknown
  } catch {
    const start = normalized.indexOf('{')
    const end = normalized.lastIndexOf('}')

    if (start >= 0 && end > start) {
      return JSON.parse(normalized.slice(start, end + 1)) as unknown
    }

    throw new Error('Model response was not valid JSON.')
  }
}

function stripCodeFences(value: string) {
  const trimmed = value.trim()
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fencedMatch?.[1]?.trim() ?? trimmed
}

function normalizeExtractedIngredientPayload(value: unknown): AiExtractedIngredientPayload {
  if (!value || typeof value !== 'object') {
    return {
      product_name: '-',
      calories: 0,
      portion_size: 1,
      portion_unit: 'g',
      macros_per_portion: {
        protein_g: 0,
        carbohydrates_g: 0,
        total_fat_g: 0
      }
    }
  }

  const payload = value as Record<string, unknown>
  const macros = payload.macros_per_portion && typeof payload.macros_per_portion === 'object'
    ? payload.macros_per_portion as Record<string, unknown>
    : {}

  return {
    product_name: normalizeProductName(payload.product_name),
    calories: normalizeNumber(payload.calories, 0),
    portion_size: normalizePositiveNumber(payload.portion_size, 1),
    portion_unit: normalizePortionUnit(payload.portion_unit),
    macros_per_portion: {
      protein_g: normalizeNumber(macros.protein_g, 0),
      carbohydrates_g: normalizeNumber(macros.carbohydrates_g, 0),
      total_fat_g: normalizeNumber(macros.total_fat_g, 0)
    }
  }
}

function validateExtractedIngredientPayload(value: unknown): asserts value is AiExtractedIngredientPayload {
  if (!value || typeof value !== 'object') {
    throw new Error('Expected a JSON object.')
  }

  const payload = value as Partial<AiExtractedIngredientPayload>

  if (typeof payload.product_name !== 'string') {
    throw new Error('product_name must be a string.')
  }

  if (typeof payload.calories !== 'number' || !Number.isFinite(payload.calories) || payload.calories < 0) {
    throw new Error('calories must be zero or a positive number.')
  }

  if (typeof payload.portion_size !== 'number' || !Number.isFinite(payload.portion_size) || payload.portion_size <= 0) {
    throw new Error('portion_size must be a number greater than 0.')
  }

  if (typeof payload.portion_unit !== 'string' || payload.portion_unit.trim().length === 0) {
    throw new Error('portion_unit must be a non-empty string.')
  }

  if (!payload.macros_per_portion || typeof payload.macros_per_portion !== 'object') {
    throw new Error('Missing macros_per_portion object.')
  }

  const macros = payload.macros_per_portion as Partial<AiExtractedIngredientPayload['macros_per_portion']>
  const values = [macros.protein_g, macros.carbohydrates_g, macros.total_fat_g]

  if (!values.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)) {
    throw new Error('macros_per_portion values must be zero or positive numbers.')
  }
}

function normalizeProductName(value: unknown) {
  if (typeof value !== 'string') {
    return '-'
  }

  const trimmed = value.trim()

  if (!trimmed || trimmed === '-') {
    return '-'
  }

  return toTitleCaseName(trimmed)
}

function normalizePortionUnit(value: unknown) {
  if (typeof value !== 'string') {
    return 'g'
  }

  const trimmed = value.trim()
  return trimmed || 'g'
}

function normalizeNumber(value: unknown, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback
  }

  return value
}

function normalizePositiveNumber(value: unknown, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback
  }

  return value
}

function toTitleCaseName(value: string) {
  const collapsed = value.trim().replace(/\s+/g, ' ')

  if (!collapsed) {
    return '-'
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

async function safeReadText(response: Response) {
  try {
    return await response.text()
  } catch {
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
