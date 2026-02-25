<script setup lang="ts">
type IngredientFormState = {
  name: string
  portionSize: string
  unit: string
  kcal: string
  protein: string
  carbs: string
  fat: string
}

const props = withDefaults(defineProps<{
  open: boolean
  mode: 'create' | 'edit'
  form: IngredientFormState
  error?: string
}>(), {
  error: ''
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:form': [value: IngredientFormState]
  'submit': []
  'cancel': []
}>()

const localForm = reactive<IngredientFormState>({
  name: '',
  portionSize: '',
  unit: '',
  kcal: '',
  protein: '',
  carbs: '',
  fat: ''
})

watch(() => props.form, (value) => {
  Object.assign(localForm, value)
}, {
  deep: true,
  immediate: true
})

watch(localForm, (value) => {
  emit('update:form', { ...value })
}, { deep: true })

const openModel = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value)
})

const modalTitle = computed(() => {
  return props.mode === 'edit' ? 'Edit ingredient' : 'Add ingredient'
})

const modalDescription = computed(() => {
  return props.mode === 'edit'
    ? 'Update the ingredient values for the portion/unit you use.'
    : 'Save values for the serving/unit you use most often (example: 100g, 1 cup, 1 scoop).'
})

const submitLabel = computed(() => {
  return props.mode === 'edit' ? 'Save changes' : 'Save ingredient'
})

function handleCancel() {
  emit('cancel')
}

function handleSubmit() {
  emit('submit')
}
</script>

<template>
  <UModal
    v-model:open="openModel"
    :title="modalTitle"
    :description="modalDescription"
  >
    <template #body>
      <form
        class="space-y-4"
        @submit.prevent="handleSubmit"
      >
        <div class="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_160px_120px]">
          <div class="space-y-2">
            <label
              for="ingredient-editor-name"
              class="block text-sm font-medium text-highlighted"
            >
              Ingredient name
            </label>
            <UInput
              id="ingredient-editor-name"
              v-model="localForm.name"
              placeholder="e.g. Rolled oats"
              size="lg"
            />
          </div>

          <div class="space-y-2">
            <label
              for="ingredient-editor-portion-size"
              class="block text-sm font-medium text-highlighted"
            >
              Portion size
            </label>
            <UInput
              id="ingredient-editor-portion-size"
              v-model="localForm.portionSize"
              type="number"
              min="0"
              step="0.01"
              inputmode="decimal"
              placeholder="100"
              size="lg"
            />
          </div>

          <div class="space-y-2">
            <label
              for="ingredient-editor-unit"
              class="block text-sm font-medium text-highlighted"
            >
              Unit
            </label>
            <UInput
              id="ingredient-editor-unit"
              v-model="localForm.unit"
              placeholder="g"
              size="lg"
            />
          </div>
        </div>

        <div class="grid gap-4 md:grid-cols-4">
          <div class="space-y-2">
            <label
              for="ingredient-editor-kcal"
              class="block text-sm font-medium text-highlighted"
            >
              Calories for portion (kcal)
            </label>
            <UInput
              id="ingredient-editor-kcal"
              v-model="localForm.kcal"
              type="number"
              min="0"
              step="1"
              inputmode="decimal"
              placeholder="150"
              size="lg"
            />
          </div>

          <div class="space-y-2">
            <label
              for="ingredient-editor-protein"
              class="block text-sm font-medium text-highlighted"
            >
              Protein for portion (g)
            </label>
            <UInput
              id="ingredient-editor-protein"
              v-model="localForm.protein"
              type="number"
              min="0"
              step="0.1"
              inputmode="decimal"
              placeholder="12"
              size="lg"
            />
          </div>

          <div class="space-y-2">
            <label
              for="ingredient-editor-carbs"
              class="block text-sm font-medium text-highlighted"
            >
              Carbs for portion (g)
            </label>
            <UInput
              id="ingredient-editor-carbs"
              v-model="localForm.carbs"
              type="number"
              min="0"
              step="0.1"
              inputmode="decimal"
              placeholder="18"
              size="lg"
            />
          </div>

          <div class="space-y-2">
            <label
              for="ingredient-editor-fat"
              class="block text-sm font-medium text-highlighted"
            >
              Fat for portion (g)
            </label>
            <UInput
              id="ingredient-editor-fat"
              v-model="localForm.fat"
              type="number"
              min="0"
              step="0.1"
              inputmode="decimal"
              placeholder="6"
              size="lg"
            />
          </div>
        </div>

        <p class="text-xs text-muted">
          The app stores per-unit values (for example kcal per g) so meal quantities can be entered in the same unit.
        </p>

        <p
          v-if="props.error"
          class="text-sm text-error"
        >
          {{ props.error }}
        </p>

        <div class="flex flex-col-reverse items-end gap-2 sm:flex-row sm:justify-end">
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            @click="handleCancel"
          >
            Cancel
          </UButton>

          <UButton
            type="submit"
            size="lg"
          >
            {{ submitLabel }}
          </UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
