<script setup lang="ts">
import { readClientCollection } from '../utils/client-db'
import { CALORIE_COLORS, MACRO_COLORS } from '../utils/nutrition-colors'
import {
  DEFAULT_CARBS_GOAL,
  DEFAULT_DAILY_CALORIE_GOAL,
  DEFAULT_FAT_GOAL,
  DEFAULT_PROTEIN_GOAL,
  readAppSettings
} from '../utils/client-settings'

interface MealEntry {
  id: string
  name: string
  calories: number
  protein: number
  carbs: number
  fat: number
  createdAt: string
}

const MEALS_COLLECTION_KEY = 'meals'

const meals = ref<MealEntry[]>([])
const dailyCalorieGoal = ref(DEFAULT_DAILY_CALORIE_GOAL)
const proteinGoal = ref(DEFAULT_PROTEIN_GOAL)
const carbsGoal = ref(DEFAULT_CARBS_GOAL)
const fatGoal = ref(DEFAULT_FAT_GOAL)
const isLoaded = ref(false)
const historyDaysAgo = ref(0)

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

const totalMacrosToday = computed(() => {
  return todayMeals.value.reduce((totals, meal) => {
    totals.protein += meal.protein
    totals.carbs += meal.carbs
    totals.fat += meal.fat

    return totals
  }, {
    protein: 0,
    carbs: 0,
    fat: 0
  })
})

const macroBarTotal = computed(() => {
  return totalMacrosToday.value.protein + totalMacrosToday.value.carbs + totalMacrosToday.value.fat
})

const macroBarSegments = computed(() => {
  const total = macroBarTotal.value
  const macros = [
    { key: 'protein', label: 'Protein', value: totalMacrosToday.value.protein, color: MACRO_COLORS.protein.solid },
    { key: 'carbs', label: 'Carbs', value: totalMacrosToday.value.carbs, color: MACRO_COLORS.carbs.solid },
    { key: 'fat', label: 'Fat', value: totalMacrosToday.value.fat, color: MACRO_COLORS.fat.solid }
  ] as const

  if (total <= 0) {
    return macros.map(macro => ({ ...macro, percent: 0 }))
  }

  return macros.map(macro => ({
    ...macro,
    percent: (macro.value / total) * 100
  }))
})

const progressPercent = computed(() => {
  if (dailyCalorieGoal.value <= 0) {
    return 0
  }

  return Math.min(100, Math.round((totalCaloriesToday.value / dailyCalorieGoal.value) * 100))
})

const remainingCalories = computed(() => {
  return Math.max(0, dailyCalorieGoal.value - totalCaloriesToday.value)
})

const calorieProgressColor = computed(() => {
  return totalCaloriesToday.value > dailyCalorieGoal.value
    ? CALORIE_COLORS.progress.overGoal
    : CALORIE_COLORS.progress.underGoal
})

const logMealMenuItems = computed(() => [[
  {
    label: 'Manually',
    icon: 'i-lucide-pencil',
    onSelect: () => {
      void navigateTo({
        path: '/meals/new',
        query: {
          date: selectedDateKey.value
        }
      })
    }
  },
  {
    label: 'With AI',
    icon: 'i-lucide-sparkles',
    onSelect: () => {
      void navigateTo({
        path: '/meals',
        query: {
          date: selectedDateKey.value,
          compose: 'ai'
        }
      })
    }
  }
]])

onMounted(async () => {
  try {
    const [loadedMeals, settings] = await Promise.all([
      loadMealsFromDb(),
      readAppSettings()
    ])

    meals.value = loadedMeals
    dailyCalorieGoal.value = settings.dailyCalorieGoal
    proteinGoal.value = settings.proteinGoal
    carbsGoal.value = settings.carbsGoal
    fatGoal.value = settings.fatGoal
  } catch (error) {
    console.error('Failed to load dashboard data from IndexedDB', error)
  } finally {
    isLoaded.value = true
  }
})

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

  return [{
    id: meal.id,
    name: meal.name.trim(),
    calories: Math.round(meal.calories),
    protein: roundToOne(protein),
    carbs: roundToOne(carbs),
    fat: roundToOne(fat),
    createdAt: meal.createdAt
  }]
}

function formatMacro(value: number) {
  const rounded = roundToOne(value)
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
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

function roundToOne(value: number) {
  return Math.round(value * 10) / 10
}

function toLocalDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}
</script>

<template>
  <div class="flex w-full max-w-5xl flex-col gap-6">
    <header class="flex flex-col gap-3">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight text-highlighted sm:text-3xl">
            Home
          </h1>
          <p class="text-sm text-muted">
            {{ todayLabel }} • Daily tracking overview from local data.
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <UDropdownMenu
            :items="logMealMenuItems"
            :content="{ align: 'end' }"
          >
            <UButton
              icon="i-lucide-plus"
              trailing-icon="i-lucide-chevron-down"
              size="sm"
            >
              Log meal
            </UButton>
          </UDropdownMenu>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
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
          variant="soft"
        >
          {{ todayMeals.length }} meal{{ todayMeals.length === 1 ? '' : 's' }} on {{ todayLabel }}
        </UBadge>
      </div>
    </header>

    <section class="grid gap-6 xl:grid-cols-[0.9fr,1.1fr]">
      <UCard class="overflow-hidden">
        <div class="space-y-5">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-sm text-muted">
                Calories
              </p>
              <p class="text-4xl font-semibold tracking-tight text-highlighted sm:text-5xl">
                {{ totalCaloriesToday.toLocaleString() }}
                <span class="text-lg font-medium text-muted">kcal</span>
              </p>
            </div>

            <UBadge
              :color="calorieProgressColor"
              variant="soft"
              class="shrink-0"
            >
              {{ progressPercent }}%
            </UBadge>
          </div>

          <div
            v-if="!isLoaded"
            class="rounded-lg border border-dashed border-default px-4 py-8 text-center text-sm text-muted"
          >
            Loading calorie tracking...
          </div>

          <div
            v-else
            class="space-y-4"
          >
            <div class="space-y-2">
              <div class="flex items-center justify-between gap-3 text-sm">
                <span class="font-medium text-highlighted">
                  {{ totalCaloriesToday.toLocaleString() }} / {{ dailyCalorieGoal.toLocaleString() }} kcal
                </span>
                <span class="text-muted">
                  {{ progressPercent }}%
                </span>
              </div>

              <UProgress
                :model-value="progressPercent"
                :max="100"
                :color="calorieProgressColor"
                size="xl"
              />
            </div>

            <p class="text-sm text-muted">
              <span v-if="totalCaloriesToday <= dailyCalorieGoal">
                {{ remainingCalories.toLocaleString() }} kcal remaining to reach {{ dailyCalorieGoal.toLocaleString() }}.
              </span>
              <span v-else>
                {{ (totalCaloriesToday - dailyCalorieGoal).toLocaleString() }} kcal over the {{ dailyCalorieGoal.toLocaleString() }} target.
              </span>
            </p>
          </div>
        </div>
      </UCard>

      <UCard class="overflow-hidden">
        <div class="space-y-5">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-sm text-muted">
                Macros
              </p>
              <p class="text-sm text-muted">
                Protein, carbs and fat for {{ todayLabel }}
              </p>
            </div>

            <UBadge
              color="neutral"
              variant="soft"
              class="shrink-0"
            >
              {{ formatMacro(totalMacrosToday.protein + totalMacrosToday.carbs + totalMacrosToday.fat) }}g total
            </UBadge>
          </div>

          <div
            v-if="!isLoaded"
            class="rounded-lg border border-dashed border-default px-4 py-8 text-center text-sm text-muted"
          >
            Loading macro tracking...
          </div>

          <div
            v-else
            class="space-y-4"
          >
            <div class="grid gap-3 sm:grid-cols-3">
              <StatGauge
                label="Protein"
                :value="totalMacrosToday.protein"
                :goal="proteinGoal"
                unit="g"
                :color="MACRO_COLORS.protein.gauge"
                :decimals="1"
                :size="116"
              />

              <StatGauge
                label="Carbs"
                :value="totalMacrosToday.carbs"
                :goal="carbsGoal"
                unit="g"
                :color="MACRO_COLORS.carbs.gauge"
                :decimals="1"
                :size="116"
              />

              <StatGauge
                label="Fat"
                :value="totalMacrosToday.fat"
                :goal="fatGoal"
                unit="g"
                :color="MACRO_COLORS.fat.gauge"
                :decimals="1"
                :size="116"
              />
            </div>

            <div class="space-y-3">
              <div>
                <div class="mb-2 flex items-center justify-between gap-3">
                  <p class="text-sm font-medium text-highlighted">
                    Macro split
                  </p>
                  <p class="text-xs text-muted">
                    By grams
                  </p>
                </div>

                <div class="h-3 overflow-hidden rounded-full border border-default bg-muted/30">
                  <div
                    v-if="macroBarTotal > 0"
                    class="flex h-full w-full"
                  >
                    <div
                      v-for="segment in macroBarSegments"
                      :key="segment.key"
                      class="h-full transition-all duration-300"
                      :style="{ width: `${segment.percent}%`, backgroundColor: segment.color }"
                    />
                  </div>
                </div>
              </div>

              <div class="flex flex-wrap gap-x-4 gap-y-2">
                <div
                  v-for="segment in macroBarSegments"
                  :key="`${segment.key}-label`"
                  class="flex items-center gap-2 text-sm"
                >
                  <span
                    class="inline-block h-2.5 w-2.5 rounded-full"
                    :style="{ backgroundColor: segment.color }"
                  />
                  <span class="text-muted">
                    {{ segment.label }}
                  </span>
                  <span class="font-semibold tabular-nums text-highlighted">
                    {{ formatMacro(segment.value) }}g
                  </span>
                  <span class="text-xs text-muted">
                    ({{ macroBarTotal > 0 ? `${Math.round(segment.percent)}%` : '0%' }})
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </UCard>
    </section>
  </div>
</template>
