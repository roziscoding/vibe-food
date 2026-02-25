<script setup lang="ts">
const props = withDefaults(defineProps<{
  modelValue: string | number
  id?: string
  placeholder?: string
  min?: number
  step?: number
  disabled?: boolean
}>(), {
  id: undefined,
  placeholder: '',
  min: 0,
  step: 1,
  disabled: false
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
}>()

const draftValue = ref(stringifyModelValue(props.modelValue))

const parsedDraftValue = computed(() => parseFlexibleDecimal(draftValue.value))
const canDecrement = computed(() => {
  if (props.disabled) {
    return false
  }

  const parsed = parsedDraftValue.value
  return parsed === null || parsed > props.min
})

watch(() => props.modelValue, (value) => {
  const next = stringifyModelValue(value)

  if (next !== draftValue.value) {
    draftValue.value = next
  }
})

watch(draftValue, (value) => {
  emit('update:modelValue', value)
})

function increment(delta: 1 | -1) {
  if (props.disabled) {
    return
  }

  const current = parsedDraftValue.value ?? Math.max(0, props.min)
  const next = Math.max(props.min, roundToThree(current + (props.step * delta)))
  draftValue.value = formatDecimal(next)
}

function normalizeOnBlur() {
  if (!draftValue.value.trim()) {
    return
  }

  const parsed = parsedDraftValue.value

  if (parsed === null) {
    return
  }

  draftValue.value = formatDecimal(Math.max(props.min, roundToThree(parsed)))
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    increment(1)
    return
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    increment(-1)
  }
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

function roundToThree(value: number) {
  return Math.round(value * 1000) / 1000
}

function formatDecimal(value: number) {
  return value.toFixed(3).replace(/\.?0+$/, '')
}

function stringifyModelValue(value: string | number) {
  return typeof value === 'number' ? String(value) : value
}
</script>

<template>
  <div class="flex items-center gap-2">
    <UButton
      type="button"
      color="neutral"
      variant="soft"
      size="sm"
      icon="i-lucide-minus"
      class="shrink-0 justify-center"
      :disabled="!canDecrement"
      @click="increment(-1)"
    />

    <UInput
      :id="id"
      v-model="draftValue"
      type="text"
      inputmode="decimal"
      autocomplete="off"
      :placeholder="placeholder"
      :disabled="disabled"
      class="min-w-0 flex-1"
      @blur="normalizeOnBlur"
      @keydown="handleKeydown"
    />

    <UButton
      type="button"
      color="neutral"
      variant="soft"
      size="sm"
      icon="i-lucide-plus"
      class="shrink-0 justify-center"
      :disabled="disabled"
      @click="increment(1)"
    />
  </div>
</template>
