import { describe, expect, it } from 'vitest'
import { supportsClaudeFastMode } from './claude-fast-mode'
import { suggestedTaskRunSettings } from './suggested-task-launch'
import type { SessionAgentProfile } from './agent-types'

describe('Claude Fast Mode admission', () => {
  it('uses SDK model support without inferring account eligibility from credentials', () => {
    expect(supportsClaudeFastMode({ supportsFastMode: true })).toBe(true)
    expect(supportsClaudeFastMode({ supportsFastMode: false })).toBe(false)
    expect(supportsClaudeFastMode({})).toBe(false)
    expect(supportsClaudeFastMode(undefined)).toBe(false)
    expect(supportsClaudeFastMode({ supportsFastMode: true }, {})).toBe(true)
    expect(supportsClaudeFastMode({ supportsFastMode: true }, { opus: { id: 'gateway-model' } })).toBe(false)
  })
  it('filters optional settings against the source host before validating a launch', () => {
    const profile: SessionAgentProfile = { id: 'claude-base', name: 'Claude', harnessId: 'claude', defaultConfig: { model: 'opus', apiProviderId: 'official' },
      models: [{ id: 'opus', name: 'Opus', supportsFastMode: true }, { id: 'sonnet', name: 'Sonnet' }], efforts: ['low', 'high'], apiProviders: [{ id: 'official', name: 'Anthropic' }, { id: 'gateway', name: 'Gateway', modelEnv: { opus: { id: 'gateway-model' } } }, { id: 'claude-account:cli', name: 'Subscription' }] }
    expect(suggestedTaskRunSettings(profile, { model: 'opus', fastMode: false, claudeFastMode: true })).toEqual({ model: 'opus', claudeFastMode: true })
    expect(suggestedTaskRunSettings(profile, { model: 'sonnet', fastMode: false, claudeFastMode: true, effort: 'unsupported' })).toEqual({ model: 'sonnet' })
    expect(suggestedTaskRunSettings(profile, { claudeFastMode: true, apiProviderId: 'gateway' })).toEqual({ apiProviderId: 'gateway' })
    expect(suggestedTaskRunSettings(profile, { claudeFastMode: true, apiProviderId: 'claude-account:cli' })).toEqual({ claudeFastMode: true, apiProviderId: 'claude-account:cli' })
    const codex = { ...profile, harnessId: 'codex' as const, models: [{ id: 'fast', name: 'Fast', serviceTiers: [{ id: 'priority', name: 'Fast', description: '' }] }] }
    expect(suggestedTaskRunSettings(codex, { model: 'fast', fastMode: true })).toEqual({ model: 'fast', fastMode: true })
    expect(suggestedTaskRunSettings(codex, { model: 'fast', fastMode: true }, false)).toEqual({ model: 'fast' })
  })
})
