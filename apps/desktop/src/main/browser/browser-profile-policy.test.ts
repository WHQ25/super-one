import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_BROWSER_PROFILE_ID } from '@superone/shared/agent-types'

const mockSettings = {
  browserMultiProfileEnabled: true,
  browserProfiles: [
    { id: DEFAULT_BROWSER_PROFILE_ID, name: 'Default', shareWithAgent: true },
    { id: 'work', name: 'Work', shareWithAgent: true },
    { id: 'personal', name: 'Personal', shareWithAgent: false },
  ],
  browserUserDefaultProfileId: 'personal',
  browserAgentDefaultProfileId: 'work',
}

vi.mock('../app-settings-service', () => ({
  readAppSettings: () => mockSettings,
}))

import { listAgentBrowserProfiles, resolveProfileForAgent, resolveProfileForUser } from './browser-profile-policy'

describe('browser-profile-policy', () => {
  it('lists only profiles shared with the agent when multi-profile is enabled', () => {
    mockSettings.browserMultiProfileEnabled = true
    expect(listAgentBrowserProfiles()).toEqual([
      { id: DEFAULT_BROWSER_PROFILE_ID, name: 'Default', isDefault: false },
      { id: 'work', name: 'Work', isDefault: true },
    ])
  })

  it('resolves user default and explicit user profile when multi-profile is enabled', () => {
    mockSettings.browserMultiProfileEnabled = true
    expect(resolveProfileForUser().id).toBe('personal')
    expect(resolveProfileForUser('work').id).toBe('work')
    expect(resolveProfileForUser('missing').id).toBe('personal')
  })

  it('resolves agent default, id, or case-insensitive name when multi-profile is enabled', () => {
    mockSettings.browserMultiProfileEnabled = true
    expect(resolveProfileForAgent().id).toBe('work')
    expect(resolveProfileForAgent(DEFAULT_BROWSER_PROFILE_ID).id).toBe(DEFAULT_BROWSER_PROFILE_ID)
    expect(resolveProfileForAgent('default').id).toBe(DEFAULT_BROWSER_PROFILE_ID)
    expect(resolveProfileForAgent('Work').id).toBe('work')
  })

  it('rejects unshared or unknown profiles for the agent', () => {
    mockSettings.browserMultiProfileEnabled = true
    expect(() => resolveProfileForAgent('personal')).toThrow('not shared with the agent')
    expect(() => resolveProfileForAgent('Personal')).toThrow('not shared with the agent')
    expect(() => resolveProfileForAgent('unknown')).toThrow('was not found')
  })

  it('falls back to default profile for both user and agent when multi-profile is disabled', () => {
    mockSettings.browserMultiProfileEnabled = false
    expect(listAgentBrowserProfiles()).toEqual([
      { id: DEFAULT_BROWSER_PROFILE_ID, name: 'Default', isDefault: true },
    ])
    expect(resolveProfileForUser('work').id).toBe(DEFAULT_BROWSER_PROFILE_ID)
    expect(resolveProfileForAgent().id).toBe(DEFAULT_BROWSER_PROFILE_ID)
    expect(resolveProfileForAgent('default').id).toBe(DEFAULT_BROWSER_PROFILE_ID)
    expect(() => resolveProfileForAgent('work')).toThrow('Multi-profile is disabled')
  })
})
