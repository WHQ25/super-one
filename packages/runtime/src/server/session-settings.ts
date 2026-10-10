import type { NodeSessionSettings } from '../session/types'

const invalid = (message: string) => Object.assign(new Error(message), { code: 'invalid_argument' })
const STRING_KEYS = ['permissionMode', 'sandboxMode', 'model', 'effort', 'apiProviderId', 'mode', 'agentPreset'] as const

/** A shared parser, so create defaults and subsequent settings edits keep the same fields. */
export function parseSessionSettings(source: Record<string, unknown>): NodeSessionSettings {
  const patch: NodeSessionSettings = {}
  for (const key of STRING_KEYS) {
    if (!Object.hasOwn(source, key)) continue
    const value = source[key]
    if (value !== null && typeof value !== 'string') throw invalid(`${key} must be a string or null`)
    patch[key] = value
  }
  if (Object.hasOwn(source, 'additionalDirectories')) {
    const dirs = source.additionalDirectories
    if (dirs !== null && (!Array.isArray(dirs) || dirs.length > 64 || dirs.some(dir => typeof dir !== 'string' || !dir.trim()))) {
      throw invalid('additionalDirectories must be an array of nonempty paths or null')
    }
    patch.additionalDirectories = dirs === null ? null : [...dirs as string[]]
  }
  return patch
}
