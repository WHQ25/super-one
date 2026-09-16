import { describe, expect, it } from 'vitest'
import {
  GROK_PLUGIN_DIRS_CAPABILITY,
  buildGrokConfigOverlay,
  buildGrokSessionMetaOverlay,
  grokInitializeAdvertisesPluginDirs,
} from './acp-session-meta'

describe('buildGrokSessionMetaOverlay', () => {
  it('omits pluginDirs unless initialize advertised the capability', () => {
    expect(buildGrokSessionMetaOverlay({
      advertisedPluginDirs: false,
      cwd: '/tmp/proj',
      extraPluginDirs: ['/tmp/extra-plugins'],
    })).toEqual({})
  })

  it('stamps advertised pluginDirs and rules', () => {
    expect(buildGrokSessionMetaOverlay({
      advertisedPluginDirs: true,
      cwd: '/no/such/project',
      extraPluginDirs: ['/abs/plugins'],
      rules: 'Be concise.',
    })).toEqual({
      pluginDirs: ['/abs/plugins'],
      rules: 'Be concise.',
    })
  })

  it('detects the initialize capability flag', () => {
    expect(grokInitializeAdvertisesPluginDirs({ [GROK_PLUGIN_DIRS_CAPABILITY]: true })).toBe(true)
    expect(grokInitializeAdvertisesPluginDirs({})).toBe(false)
  })
})

describe('buildGrokConfigOverlay', () => {
  it('drops secrets and auth tables', () => {
    expect(buildGrokConfigOverlay({
      api_key: 'sk-secret',
      auth: { token: 'nope' },
      plugins: { extra_dirs: ['/abs/plugins'] },
    })).toBe(JSON.stringify({ plugins: { extra_dirs: ['/abs/plugins'] } }))
  })

  it('returns null when nothing safe remains', () => {
    expect(buildGrokConfigOverlay({ apiKey: 'x', token: 'y' })).toBeNull()
  })
})
