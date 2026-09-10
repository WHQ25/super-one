import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Pure state modules only. React Native component tests live under
    // `*.test.tsx` and run on jest-expo (`jest.config.js`) — vitest cannot load
    // React Native, whose lazy `require()` calls escape Vite's ESM pipeline and
    // reach Node as unparsable Flow source.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'plugins/**/*.test.ts'],
  },
})
