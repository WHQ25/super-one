import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/**
 * Whether `@cursor/sdk` can be resolved in this process.
 * Used by enable/probe without depending on `@superone/cursor`.
 */
export function isCursorSdkAvailable(): boolean {
  try {
    require.resolve('@cursor/sdk')
    return true
  } catch {
    return false
  }
}

/**
 * Plain `CURSOR_API_KEY` from the process environment (no config decrypt).
 */
export function resolveCursorApiKeyPlain(): string | undefined {
  const v = process.env.CURSOR_API_KEY?.trim()
  return v || undefined
}
