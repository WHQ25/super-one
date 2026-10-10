import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from '@playwright/test'

// Keep generated HTML/traces outside Vite/Tailwind's watched workspace.
const checkout = createHash('sha256').update(import.meta.dirname).digest('hex').slice(0, 12)
export default defineConfig({
  testDir: './e2e',
  testMatch: 'chat-transcript-virtualization.storybook.ts',
  outputDir: join(tmpdir(), `superone-transcript-${checkout}`),
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
