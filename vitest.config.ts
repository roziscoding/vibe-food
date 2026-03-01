import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '#shared': resolve(__dirname, 'shared')
    }
  },
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts']
  }
})
