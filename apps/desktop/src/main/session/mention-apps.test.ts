import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  connected: false,
  browsers: [] as string[],
  granted: [] as string[],
}))

vi.mock('../browser/chrome-bridge-hub', () => ({
  chromeBridgeHub: {
    get connected() { return state.connected },
    browsers: () => state.browsers,
  },
}))
vi.mock('../computer-use/tools', () => ({
  grantComputerUseSessionApps: (_sessionId: string, apps: Array<{ bundleId: string }>) => {
    state.granted = apps.map((app) => app.bundleId)
    return apps.length
  },
}))
vi.mock('../mcp/superone-mcp-server', () => ({
  authorizeMentionedMiniApps: async () => [],
}))

import { authorizeMentionApps } from './mention-apps'

const apps = [
  { app: 'Notes', bundleId: 'com.apple.Notes' },
  { app: 'Google Chrome', bundleId: 'com.google.Chrome' },
  { app: 'Arc', bundleId: 'company.thebrowser.Browser' },
]

describe('mention app grants', () => {
  beforeEach(() => {
    state.connected = false
    state.browsers = []
    state.granted = []
  })

  it('grants every desktop app to Computer Use when the extension is disconnected', async () => {
    const result = await authorizeMentionApps('sid', '/proj', { miniappIds: [], desktopApps: apps }, () => {})
    expect(state.granted).toEqual(['com.apple.Notes', 'com.google.Chrome', 'company.thebrowser.Browser'])
    expect(result).toEqual({ miniappIds: [], desktopAppsGranted: true, chromeBrowserBundleIds: [] })
  })

  it('keeps only the connected browser off the Computer Use grant', async () => {
    state.connected = true
    state.browsers = ['chrome']
    const result = await authorizeMentionApps('sid', '/proj', { miniappIds: [], desktopApps: apps }, () => {})
    expect(state.granted).toEqual(['com.apple.Notes', 'company.thebrowser.Browser'])
    expect(result.chromeBrowserBundleIds).toEqual(['com.google.Chrome'])
    expect(result.desktopAppsGranted).toBe(true)
  })
})
