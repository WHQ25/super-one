/**
 * Which browser MCP surface a session advertises.
 *
 * Resolution (first hit wins):
 *   1. test override
 *   2. env SUPERONE_BROWSER_TOOLS=legacy|compact
 *   3. AppSettings.browserToolSurface
 *   4. default legacy (packaged / official builds stay on the 30-tool surface)
 *
 * The first resolve for a sessionId is sticky so Codex's one-shot tools/list
 * and later execute stay on the same set. Flag flips apply to new sessions.
 */

import {
  BROWSER_COMPACT_TOOL_NAMES,
  BROWSER_LEGACY_TOOL_NAMES,
} from '@superone/shared/superone-host-owned-tools'
import { readAppSettings } from '../app-settings-service'

export type BrowserToolSurface = 'legacy' | 'compact'

const ENV_KEY = 'SUPERONE_BROWSER_TOOLS'

let override: BrowserToolSurface | null = null
const sessionLock = new Map<string, BrowserToolSurface>()

export function setBrowserToolSurfaceForTests(surface: BrowserToolSurface | null): void {
  override = surface
}

export function clearBrowserToolSurfaceLocks(): void {
  sessionLock.clear()
}

export function clearBrowserToolSurfaceLock(sessionId: string): void {
  sessionLock.delete(sessionId)
}

export function parseBrowserToolSurface(raw: unknown): BrowserToolSurface | null {
  return raw === 'legacy' || raw === 'compact' ? raw : null
}

function computeSurface(): BrowserToolSurface {
  if (override) return override
  const fromEnv = parseBrowserToolSurface(process.env[ENV_KEY])
  if (fromEnv) return fromEnv
  try {
    const fromSettings = parseBrowserToolSurface(readAppSettings().browserToolSurface)
    if (fromSettings) return fromSettings
  } catch {
    // settings unavailable (tests, early boot)
  }
  return 'legacy'
}

export function resolveBrowserToolSurface(sessionId?: string): BrowserToolSurface {
  if (sessionId && sessionLock.has(sessionId)) return sessionLock.get(sessionId)!
  const surface = computeSurface()
  if (sessionId) sessionLock.set(sessionId, surface)
  return surface
}

export function advertisedBrowserToolNames(surface: BrowserToolSurface): readonly string[] {
  return surface === 'legacy' ? BROWSER_LEGACY_TOOL_NAMES : BROWSER_COMPACT_TOOL_NAMES
}
