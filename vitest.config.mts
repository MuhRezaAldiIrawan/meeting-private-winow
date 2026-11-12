import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const root = process.cwd()

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(root, 'src/shared'),
      '@main': resolve(root, 'src/main'),
      '@renderer': resolve(root, 'src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    restoreMocks: true
  }
})
