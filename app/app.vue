<script setup lang="ts">
useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1' },
    { name: 'theme-color', content: '#00C16A' },
    { name: 'apple-mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
    { name: 'apple-mobile-web-app-title', content: 'Vibe Food' },
    { name: 'mobile-web-app-capable', content: 'yes' }
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico' },
    { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }
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

const activeNavItem = computed(() => {
  return navItems.find(item => isRouteActive(item.to)) ?? navItems[0]
})

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
    <div class="min-h-screen min-h-dvh bg-gradient-to-b from-green-50/50 via-white to-white dark:from-green-950/20 dark:via-neutral-950 dark:to-neutral-950">
      <div class="mx-auto w-full max-w-7xl px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
        <header class="mb-4 lg:hidden">
          <div class="rounded-2xl border border-default/70 bg-white/85 px-4 py-3 shadow-sm backdrop-blur dark:bg-neutral-950/75">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="text-xs font-semibold tracking-[0.14em] text-primary uppercase">
                  🍽️ Vibe Food
                </p>
                <p class="truncate text-xs text-muted">
                  {{ activeNavItem.label }} · Local-first meal tracking
                </p>
              </div>
            </div>
          </div>
        </header>

        <div class="grid gap-4 pb-24 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-6 lg:pb-0">
          <aside class="hidden lg:sticky lg:top-6 lg:block lg:self-start">
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

      <nav
        class="mobile-tabbar border-t border-default/70 bg-white/85 backdrop-blur dark:bg-neutral-950/85 lg:hidden"
        aria-label="Primary navigation"
      >
        <div class="mx-auto grid w-full max-w-7xl grid-cols-4 gap-1 px-2 pt-2">
          <UButton
            v-for="item in navItems"
            :key="`mobile-${item.to}`"
            :to="item.to"
            :icon="item.icon"
            :color="isRouteActive(item.to) ? 'primary' : 'neutral'"
            :variant="isRouteActive(item.to) ? 'soft' : 'ghost'"
            :aria-current="isRouteActive(item.to) ? 'page' : undefined"
            class="min-h-14 flex-col justify-center gap-1 px-1 text-[11px]"
            size="sm"
          >
            {{ item.label }}
          </UButton>
        </div>
      </nav>
    </div>
  </UApp>
</template>
