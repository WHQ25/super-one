import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The SVG package uses extensionless ESM imports; let Vite resolve them.
    server: { deps: { inline: [/@lobehub\/icons/] } },
    include: ['src/**/*.test.ts'],
  },
})
