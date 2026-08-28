/**
 * Which browser MCP surface a session advertises.
 *
 * Resolution (first hit wins):
 *   1. test override
 *   2. env SUPERONE_BROWSER_TOOLS=legacy|compact
 *   3. default compact (the shipping surface)
 *
 * `legacy` survives only as an env-var escape hatch for debugging a model that
 * misbehaves on the phase tools. It is deliberately not a user setting: the
 * legacy 30 primitives stay *callable* either way (executeBrowserTool resolves
 * the union), so old transcripts, saved actions and host-actions keep working
 * without the 30-tool list being advertised.
 */

import {
  BROWSER_COMPACT_TOOL_NAMES,
  BROWSER_LEGACY_TOOL_NAMES,
} from '@superone/shared/superone-host-owned-tools'

export type BrowserToolSurface = 'legacy' | 'compact'

const ENV_KEY = 'SUPERONE_BROWSER_TOOLS'

let override: BrowserToolSurface | null = null

export function setBrowserToolSurfaceForTests(surface: BrowserToolSurface | null): void {
  override = surface
}

export function parseBrowserToolSurface(raw: unknown): BrowserToolSurface | null {
  return raw === 'legacy' || raw === 'compact' ? raw : null
}

export function resolveBrowserToolSurface(): BrowserToolSurface {
  return override ?? parseBrowserToolSurface(process.env[ENV_KEY]) ?? 'compact'
}

export function advertisedBrowserToolNames(surface: BrowserToolSurface): readonly string[] {
  return surface === 'legacy' ? BROWSER_LEGACY_TOOL_NAMES : BROWSER_COMPACT_TOOL_NAMES
}
