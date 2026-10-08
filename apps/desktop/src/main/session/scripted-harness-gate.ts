import { app } from 'electron'

/**
 * End-to-end tests replace every harness with scripted turns
 * (`backends/scripted-backend.ts`). Only an unpackaged build started with this
 * variable does; a packaged app ignores it, so no shipped build can run them.
 */
export const SCRIPTED_HARNESS_ENV = 'SUPERONE_E2E_SCRIPTED_HARNESS'

export function scriptedHarnessEnabled(): boolean {
  return process.env[SCRIPTED_HARNESS_ENV] === '1' && !app.isPackaged
}
