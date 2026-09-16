import { statSync } from 'fs'
import { join } from 'path'

/** initialize `_meta` key Grok sets when session/new accepts `pluginDirs`. */
export const GROK_PLUGIN_DIRS_CAPABILITY = 'x.ai/pluginDirs'

const SECRET_KEY = /api[_-]?key|token|secret|password|^auth$|auth_provider|model_providers/i

export function grokInitializeAdvertisesPluginDirs(
  meta: Record<string, unknown> | null | undefined,
): boolean {
  return meta?.[GROK_PLUGIN_DIRS_CAPABILITY] === true
}

export function projectGrokPluginDir(cwd: string): string | null {
  const dir = join(cwd, '.grok', 'plugins')
  try {
    if (statSync(dir).isDirectory()) return dir
  } catch {
    /* missing */
  }
  return null
}

export function buildGrokSessionMetaOverlay(opts: {
  advertisedPluginDirs: boolean
  cwd: string
  extraPluginDirs?: string[]
  rules?: string | null
  systemPromptOverride?: string | null
}): Record<string, unknown> {
  const overlay: Record<string, unknown> = {}
  if (opts.advertisedPluginDirs) {
    const dirs = [
      ...(opts.extraPluginDirs ?? []),
      projectGrokPluginDir(opts.cwd),
    ].filter((d): d is string => typeof d === 'string' && d.length > 0)
    const unique = [...new Set(dirs)]
    if (unique.length > 0) overlay.pluginDirs = unique
  }
  const rules = opts.rules?.trim()
  if (rules) overlay.rules = rules
  const override = opts.systemPromptOverride?.trim()
  if (override) overlay.systemPromptOverride = override
  return overlay
}

/** Inline GROK_CONFIG JSON. Drops secrets / auth tables. Empty → null (do not set env). */
export function buildGrokConfigOverlay(input: Record<string, unknown>): string | null {
  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (SECRET_KEY.test(key)) continue
    cleaned[key] = value
  }
  if (Object.keys(cleaned).length === 0) return null
  return JSON.stringify(cleaned)
}
