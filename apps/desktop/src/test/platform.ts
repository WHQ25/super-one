import { afterAll, beforeAll } from 'vitest'

const ORIGINAL_PLATFORM = process.platform

export function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

export function restorePlatform(): void {
  setPlatform(ORIGINAL_PLATFORM)
}

/**
 * Run the enclosing `describe` (or file) as if on `platform`.
 *
 * For code that branches on `process.platform` at call time. The suite runs on
 * Linux in CI, so a test that describes macOS-only behaviour (Electron Helper
 * bundles, the Computer Use helper, the iOS device agent) has to say so, or it
 * silently exercises the "unsupported platform" early return instead.
 */
export function usePlatform(platform: NodeJS.Platform): void {
  beforeAll(() => setPlatform(platform))
  afterAll(restorePlatform)
}
