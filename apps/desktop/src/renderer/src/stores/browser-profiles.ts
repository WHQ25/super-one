import { create } from 'zustand'
import {
  DEFAULT_BROWSER_PROFILE_ID,
  type AppSettings,
  type AppSettingsPatch,
  type BrowserProfile,
} from '@superone/shared/agent-types'

interface BrowserProfilesStore {
  enabled: boolean
  profiles: BrowserProfile[]
  userDefaultProfileId: string
  agentDefaultProfileId: string | null
  loaded: boolean
  load: () => Promise<void>
  applySettings: (settings: Pick<AppSettings, 'browserMultiProfileEnabled' | 'browserProfiles' | 'browserUserDefaultProfileId' | 'browserAgentDefaultProfileId'>) => void
  setEnabled: (enabled: boolean) => Promise<void>
  createProfile: (name: string, shareWithAgent?: boolean) => Promise<BrowserProfile>
  renameProfile: (id: string, name: string) => Promise<void>
  toggleShareWithAgent: (id: string, shareWithAgent: boolean) => Promise<void>
  setUserDefault: (id: string) => Promise<void>
  setAgentDefault: (id: string | null) => Promise<void>
  deleteProfile: (id: string) => Promise<void>
  clearProfileData: (id: string) => Promise<void>
}

const DEFAULT_PROFILE: BrowserProfile = {
  id: DEFAULT_BROWSER_PROFILE_ID,
  name: 'Default',
  shareWithAgent: true,
}

async function persist(patch: AppSettingsPatch): Promise<void> {
  const saved = await window.app.saveAppSettings(patch)
  if (saved?.browserProfiles) {
    useBrowserProfilesStore.getState().applySettings(saved)
  }
}

let subscribed = false

export const useBrowserProfilesStore = create<BrowserProfilesStore>((set, get) => ({
  enabled: false,
  profiles: [DEFAULT_PROFILE],
  userDefaultProfileId: DEFAULT_BROWSER_PROFILE_ID,
  agentDefaultProfileId: DEFAULT_BROWSER_PROFILE_ID,
  loaded: false,
  applySettings: (settings) => {
    set({
      enabled: settings.browserMultiProfileEnabled === true,
      profiles: settings.browserProfiles?.length ? settings.browserProfiles : [DEFAULT_PROFILE],
      userDefaultProfileId: settings.browserUserDefaultProfileId || DEFAULT_BROWSER_PROFILE_ID,
      agentDefaultProfileId: settings.browserAgentDefaultProfileId ?? null,
      loaded: true,
    })
  },
  setEnabled: async (enabled) => {
    set({ enabled })
    await persist({ browserMultiProfileEnabled: enabled })
  },
  load: async () => {
    if (!subscribed) {
      subscribed = true
      window.app.onAppSettingsChange?.((next) => {
        if (next?.browserProfiles) get().applySettings(next)
      })
    }
    if (get().loaded) return
    try {
      const settings = await window.app.getAppSettings?.()
      if (settings?.browserProfiles) {
        get().applySettings(settings)
      } else {
        set({ loaded: true })
      }
    } catch {
      set({ loaded: true })
    }
  },
  createProfile: async (rawName, shareWithAgent = false) => {
    const name = rawName.trim()
    if (!name) throw new Error('Profile name cannot be empty')
    const { profiles, agentDefaultProfileId } = get()
    if (profiles.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('A profile with this name already exists')
    }
    const profile: BrowserProfile = {
      id: crypto.randomUUID().slice(0, 8),
      name,
      shareWithAgent,
    }
    await window.app.ensureBrowserProfileSession?.(profile.id)
    const nextProfiles = [...profiles, profile]
    const nextAgentDefault = shareWithAgent && !agentDefaultProfileId ? profile.id : agentDefaultProfileId
    set({ profiles: nextProfiles, agentDefaultProfileId: nextAgentDefault })
    await persist({
      browserProfiles: nextProfiles,
      browserAgentDefaultProfileId: nextAgentDefault,
    })
    return profile
  },
  renameProfile: async (id, rawName) => {
    const name = rawName.trim()
    if (!name) throw new Error('Profile name cannot be empty')
    const { profiles } = get()
    if (profiles.some((p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('A profile with this name already exists')
    }
    const nextProfiles = profiles.map((p) => (p.id === id ? { ...p, name } : p))
    set({ profiles: nextProfiles })
    await persist({ browserProfiles: nextProfiles })
  },
  toggleShareWithAgent: async (id, shareWithAgent) => {
    const { profiles, agentDefaultProfileId } = get()
    const nextProfiles = profiles.map((p) => (p.id === id ? { ...p, shareWithAgent } : p))
    const shared = nextProfiles.filter((p) => p.shareWithAgent)
    let nextAgentDefault = agentDefaultProfileId
    if (!shareWithAgent && agentDefaultProfileId === id) {
      nextAgentDefault = shared[0]?.id ?? null
    } else if (shareWithAgent && !agentDefaultProfileId) {
      nextAgentDefault = id
    }
    set({ profiles: nextProfiles, agentDefaultProfileId: nextAgentDefault })
    await persist({
      browserProfiles: nextProfiles,
      browserAgentDefaultProfileId: nextAgentDefault,
    })
  },
  setUserDefault: async (id) => {
    set({ userDefaultProfileId: id })
    await persist({ browserUserDefaultProfileId: id })
  },
  setAgentDefault: async (id) => {
    set({ agentDefaultProfileId: id })
    await persist({ browserAgentDefaultProfileId: id })
  },
  deleteProfile: async (id) => {
    if (id === DEFAULT_BROWSER_PROFILE_ID) return
    const { profiles, userDefaultProfileId, agentDefaultProfileId } = get()
    const nextProfiles = profiles.filter((p) => p.id !== id)
    const nextUserDefault = userDefaultProfileId === id ? DEFAULT_BROWSER_PROFILE_ID : userDefaultProfileId
    const shared = nextProfiles.filter((p) => p.shareWithAgent)
    const nextAgentDefault = agentDefaultProfileId === id ? (shared[0]?.id ?? null) : agentDefaultProfileId
    set({
      profiles: nextProfiles,
      userDefaultProfileId: nextUserDefault,
      agentDefaultProfileId: nextAgentDefault,
    })
    await persist({
      browserProfiles: nextProfiles,
      browserUserDefaultProfileId: nextUserDefault,
      browserAgentDefaultProfileId: nextAgentDefault,
    })
    await window.app.clearBrowserProfileData?.(id, true)
  },
  clearProfileData: async (id) => {
    await window.app.clearBrowserProfileData?.(id, false)
  },
}))

export function profileInitial(name: string): string {
  const first = Array.from(name.trim())[0]
  return first ? first.toUpperCase() : '?'
}
