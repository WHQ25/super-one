import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 20_000,
  expect: { timeout: 8_000 },
  use: {
    browserName: 'chromium',
    headless: true,
    viewport: { width: 430, height: 780 },
  },
})
