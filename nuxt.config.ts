// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({

  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@vite-pwa/nuxt'
  ],
  ssr: false,

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],
  devServer: {
    port: 3123
  },

  compatibilityDate: '2025-01-15',

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  },

  pwa: {
    registerType: 'autoUpdate',
    includeAssets: [
      'favicon.ico',
      'apple-touch-icon.png'
    ],
    manifest: {
      id: '/',
      name: 'Vibe Food',
      short_name: 'Vibe Food',
      description: 'Track meals and daily calories locally in your browser.',
      theme_color: '#00C16A',
      background_color: '#ffffff',
      display: 'standalone',
      orientation: 'portrait',
      start_url: '/',
      scope: '/',
      lang: 'en',
      categories: ['food', 'health', 'productivity'],
      icons: [
        {
          src: '/pwa/icon-192.png',
          sizes: '192x192',
          type: 'image/png'
        },
        {
          src: '/pwa/icon-512.png',
          sizes: '512x512',
          type: 'image/png'
        },
        {
          src: '/pwa/icon-maskable-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable'
        }
      ]
    },
    workbox: {
      navigateFallback: '/',
      cleanupOutdatedCaches: true,
      globPatterns: ['**/*.{js,css,html,ico,png,svg,json,webp,woff2}']
    },
    devOptions: {
      enabled: false
    }
  }
})
