import { DEFAULT_BROWSER_PROFILE_ID, type BrowserProfile } from '@superone/shared/agent-types'
import { readAppSettings } from '../app-settings-service'

const FALLBACK_PROFILE: BrowserProfile = {
  id: DEFAULT_BROWSER_PROFILE_ID,
  name: 'Default',
  shareWithAgent: true,
}

function getProfiles(): BrowserProfile[] {
  const settings = readAppSettings()
  return settings.browserProfiles ?? [FALLBACK_PROFILE]
}

function defaultProfile(): BrowserProfile {
  return getProfiles().find((p) => p.id === DEFAULT_BROWSER_PROFILE_ID) ?? FALLBACK_PROFILE
}

export function isMultiProfileEnabled(): boolean {
  return readAppSettings().browserMultiProfileEnabled === true
}

export function resolveProfileForUser(requestedId?: string | null): BrowserProfile {
  if (!isMultiProfileEnabled()) return defaultProfile()
  const settings = readAppSettings()
  const profiles = getProfiles()
  if (requestedId) {
    const match = profiles.find((p) => p.id === requestedId)
    if (match) return match
  }
  return profiles.find((p) => p.id === settings.browserUserDefaultProfileId) ?? profiles[0]
}

export function listAgentBrowserProfiles(): Array<{ id: string; name: string; isDefault: boolean }> {
  if (!isMultiProfileEnabled()) {
    const def = defaultProfile()
    return [{ id: def.id, name: def.name, isDefault: true }]
  }
  const settings = readAppSettings()
  const profiles = getProfiles()
  return profiles
    .filter((p) => p.shareWithAgent)
    .map((p) => ({
      id: p.id,
      name: p.name,
      isDefault: p.id === settings.browserAgentDefaultProfileId,
    }))
}

export function resolveProfileForAgent(requested?: string | null): BrowserProfile {
  const needle = requested?.trim()
  if (!isMultiProfileEnabled()) {
    const def = defaultProfile()
    if (needle && needle !== def.id && needle.toLowerCase() !== def.name.toLowerCase()) {
      throw new Error('Multi-profile is disabled in Browser Settings. Only the default profile is available.')
    }
    return { ...def, shareWithAgent: true }
  }
  const settings = readAppSettings()
  const profiles = getProfiles()
  const shared = profiles.filter((p) => p.shareWithAgent)
  if (shared.length === 0) {
    throw new Error('No built-in browser profiles are shared with the agent. Enable at least one profile in Browser Settings.')
  }
  if (needle) {
    const byId = shared.find((p) => p.id === needle)
    if (byId) return byId
    const lower = needle.toLowerCase()
    const byName = shared.find((p) => p.name.toLowerCase() === lower)
    if (byName) return byName
    const existsUnshared = profiles.some(
      (p) => p.id === needle || p.name.toLowerCase() === lower,
    )
    if (existsUnshared) {
      throw new Error(`Browser profile "${needle}" is not shared with the agent.`)
    }
    throw new Error(`Browser profile "${needle}" was not found. Call browser_profiles to see available profiles.`)
  }
  if (settings.browserAgentDefaultProfileId) {
    const def = shared.find((p) => p.id === settings.browserAgentDefaultProfileId)
    if (def) return def
  }
  return shared[0]
}
