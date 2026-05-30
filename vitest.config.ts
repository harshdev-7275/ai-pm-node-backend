import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      thresholds: { lines: 80, functions: 80, branches: 70 },
    },
  },
})
