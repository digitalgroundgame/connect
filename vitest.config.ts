import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      // Next.js resolves this marker package; outside Next it would throw.
      'server-only': path.resolve(import.meta.dirname, 'tests/server-only.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // The database tests share one schema, so run files one at a time.
    fileParallelism: false,
  },
})
