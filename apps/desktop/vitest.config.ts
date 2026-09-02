import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  server: {
    host: true,
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/renderer/src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    server: {
      deps: {
        inline: [/@lobehub\//, /@emoji-mart\//],
      },
    },
    include: [
      'src/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      '../../packages/shared/src/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      '../../packages/ui/src/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      // Release tooling. Without this the suite silently skipped
      // scripts/lib/channels.test.ts, which looked like coverage of the
      // update-manifest logic and was never executed.
      '../../scripts/**/*.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
})
