<script setup lang="ts">
useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' }
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico' }
  ],
  htmlAttrs: {
    lang: 'en'
  }
})

const title = '🍽️ Vibe Food'
const description = 'Track meals and daily calories locally in your browser.'
const route = useRoute()
const navItems = [
  { label: 'Home', to: '/', icon: 'i-lucide-house' },
  { label: 'Meals', to: '/meals', icon: 'i-lucide-utensils' },
  { label: 'Ingredients', to: '/ingredients', icon: 'i-lucide-apple' },
  { label: 'Settings', to: '/settings', icon: 'i-lucide-sliders-horizontal' }
] as const

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description,
  twitterCard: 'summary_large_image'
})

function isRouteActive(to: string) {
  if (to === '/') {
    return route.path === '/'
  }

  return route.path.startsWith(to)
}
</script>

<template>
  <UApp>
    <div class="min-h-screen bg-gradient-to-b from-green-50/50 via-white to-white dark:from-green-950/20 dark:via-neutral-950 dark:to-neutral-950">
      <div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div class="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside class="lg:sticky lg:top-6 lg:self-start">
            <UCard>
              <div class="space-y-4">
                <div>
                  <p class="text-xs font-semibold tracking-[0.14em] text-primary uppercase">
                    🍽️ Vibe Food
                  </p>
                  <p class="mt-1 text-sm text-muted">
                    Local-first meal tracking
                  </p>
                </div>

                <USeparator />

                <nav class="flex flex-col gap-2">
                  <UButton
                    v-for="item in navItems"
                    :key="item.to"
                    :to="item.to"
                    :icon="item.icon"
                    :color="isRouteActive(item.to) ? 'primary' : 'neutral'"
                    :variant="isRouteActive(item.to) ? 'soft' : 'ghost'"
                    :aria-current="isRouteActive(item.to) ? 'page' : undefined"
                    class="w-full justify-start"
                    size="lg"
                  >
                    {{ item.label }}
                  </UButton>
                </nav>
              </div>
            </UCard>
          </aside>

          <section class="min-w-0">
            <NuxtPage />
          </section>
        </div>
      </div>
    </div>
  </UApp>
</template>
