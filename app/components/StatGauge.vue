<script setup lang="ts">
const props = withDefaults(defineProps<{
  label: string
  value: number
  goal: number
  unit?: string
  color?: string
  trackColor?: string
  size?: number
  strokeWidth?: number
  decimals?: number
}>(), {
  unit: '',
  color: '#22c55e',
  trackColor: 'rgba(148, 163, 184, 0.22)',
  size: 120,
  strokeWidth: 10,
  decimals: 0
})

const normalizedGoal = computed(() => {
  return Number.isFinite(props.goal) && props.goal > 0 ? props.goal : 0
})

const rawRatio = computed(() => {
  if (normalizedGoal.value <= 0) {
    return 0
  }

  return props.value / normalizedGoal.value
})

const ringRatio = computed(() => {
  return Math.max(0, Math.min(1, rawRatio.value))
})

const percent = computed(() => {
  return Math.max(0, Math.round(rawRatio.value * 100))
})

const center = computed(() => props.size / 2)
const radius = computed(() => Math.max(0, (props.size - props.strokeWidth) / 2))
const circumference = computed(() => 2 * Math.PI * radius.value)
const dashOffset = computed(() => circumference.value * (1 - ringRatio.value))

const formattedValue = computed(() => formatNumber(props.value, props.decimals))
const formattedGoal = computed(() => formatNumber(normalizedGoal.value, props.decimals))

const ariaLabel = computed(() => {
  const unitText = props.unit ? ` ${props.unit}` : ''
  return `${props.label}: ${formattedValue.value}${unitText} of ${formattedGoal.value}${unitText} (${percent.value}%)`
})

function formatNumber(value: number, decimals: number) {
  const safe = Number.isFinite(value) ? value : 0
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0
  }).format(safe)
}
</script>

<template>
  <div class="rounded-xl border border-default bg-default/70 px-3 py-4">
    <div class="flex justify-center">
      <div
        class="relative shrink-0"
        :style="{ width: `${size}px`, height: `${size}px` }"
        role="img"
        :aria-label="ariaLabel"
      >
        <svg
          :width="size"
          :height="size"
          :viewBox="`0 0 ${size} ${size}`"
          class="-rotate-90"
        >
          <circle
            :cx="center"
            :cy="center"
            :r="radius"
            fill="none"
            :stroke="trackColor"
            :stroke-width="strokeWidth"
          />
          <circle
            :cx="center"
            :cy="center"
            :r="radius"
            fill="none"
            :stroke="color"
            :stroke-width="strokeWidth"
            stroke-linecap="round"
            :stroke-dasharray="circumference"
            :stroke-dashoffset="dashOffset"
            class="transition-all duration-300"
          />
        </svg>

        <div class="absolute inset-0 flex flex-col items-center justify-center">
          <p class="text-xl font-semibold tracking-tight text-highlighted">
            {{ formattedValue }}
            <span
              v-if="unit"
              class="ml-0.5 text-xs font-medium text-muted"
            >
              {{ unit }}
            </span>
          </p>
          <p
            class="text-xs font-medium"
            :style="{ color }"
          >
            {{ percent }}%
          </p>
        </div>
      </div>
    </div>

    <div class="mt-3 space-y-0.5 text-center">
      <p class="text-sm font-medium text-highlighted">
        {{ label }}
      </p>
      <p class="text-xs text-muted">
        Goal {{ formattedGoal }}{{ unit }}
      </p>
    </div>
  </div>
</template>
