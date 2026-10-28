import { describe, expect, it } from 'vitest'
import { parseSuggestedTaskChoice, suggestedTaskRunSettings } from './suggested-task-launch'
import type { SessionAgentProfile } from './agent-types'
import {
  codexModelSwitchSpeedPatch,
  codexSelectedServiceTier,
  codexServiceTierFromSpeedParam,
  codexSpeedOptionParam,
  codexSpeedSelectionPatch,
  codexSpeedTriggerLabel,
} from './codex-fast-mode'

const fastOnly = {
  serviceTiers: [{ id: 'priority', name: 'Fast', description: 'Lower latency' }],
}
const withUltrafast = {
  serviceTiers: [
    { id: 'priority', name: 'Fast', description: '' },
    { id: 'ultrafast', name: 'Ultrafast', description: '' },
  ],
}

describe('codex speed option', () => {
  it('keeps a Fast-only catalog on the On/Off toggle', () => {
    expect(codexSpeedOptionParam(fastOnly, null)).toMatchObject({ id: 'fast', kind: 'toggle', selected: 'false' })
    expect(codexSpeedOptionParam(fastOnly, 'priority')?.selected).toBe('true')
    expect(codexSpeedOptionParam({ serviceTiers: [] }, 'priority')).toBeNull()
  })

  it('offers Standard and each advertised tier when the catalog has more than Fast', () => {
    const param = codexSpeedOptionParam(withUltrafast, 'ultrafast')
    expect(param).toMatchObject({ id: 'serviceTier', kind: 'choice', label: 'Speed', selected: 'ultrafast' })
    expect(param?.values.map((value) => value.label)).toEqual(['Standard', 'Fast', 'Ultrafast'])
    expect(codexSpeedOptionParam(withUltrafast, 'missing')?.selected).toBe('')
    expect(codexSpeedOptionParam({
      serviceTiers: [{ id: 'ultrafast', name: 'Ultrafast', description: '' }],
    }, null)?.values.map((value) => value.value)).toEqual(['', 'ultrafast'])
  })

  it('maps a speed row back to a catalog id and ignores other rows', () => {
    expect(codexServiceTierFromSpeedParam(fastOnly, 'fast', 'true')).toBe('priority')
    expect(codexServiceTierFromSpeedParam(fastOnly, 'fast', 'false')).toBeNull()
    expect(codexServiceTierFromSpeedParam(withUltrafast, 'serviceTier', '')).toBeNull()
    expect(codexServiceTierFromSpeedParam(withUltrafast, 'serviceTier', 'ultrafast')).toBe('ultrafast')
    expect(codexServiceTierFromSpeedParam(withUltrafast, 'serviceTier', 'nope')).toBeNull()
    expect(codexServiceTierFromSpeedParam(withUltrafast, 'effort', 'high')).toBeUndefined()
  })

  it('labels the trigger Fast for the toggle and the tier name otherwise', () => {
    expect(codexSpeedTriggerLabel([{ id: 'fast', selected: 'true', values: [] }])).toBe('Fast')
    expect(codexSpeedTriggerLabel([{ id: 'fast', selected: 'false', values: [] }])).toBeNull()
    const choice = codexSpeedOptionParam(withUltrafast, 'ultrafast')!
    expect(codexSpeedTriggerLabel([choice])).toBe('Ultrafast')
    expect(codexSpeedTriggerLabel([codexSpeedOptionParam(withUltrafast, null)!])).toBeNull()
  })

  it('shows an explicit tier, treats null as Standard, and defers to Fast when absent', () => {
    expect(codexSelectedServiceTier(withUltrafast, { serviceTier: 'ultrafast', fastMode: false })).toBe('ultrafast')
    expect(codexSelectedServiceTier(withUltrafast, { serviceTier: null, fastMode: true })).toBeNull()
    expect(codexSelectedServiceTier(fastOnly, { fastMode: true })).toBe('priority')
    expect(codexSelectedServiceTier(withUltrafast, { serviceTier: 'stale' })).toBeNull()
  })

  it('keeps a listed tier across a model change and clears one the next model lacks', () => {
    expect(codexModelSwitchSpeedPatch(withUltrafast, 'ultrafast')).toEqual({})
    expect(codexModelSwitchSpeedPatch(withUltrafast, null)).toEqual({})
    expect(codexModelSwitchSpeedPatch(fastOnly, 'ultrafast')).toEqual({ fastMode: false, serviceTier: null })
    expect(codexModelSwitchSpeedPatch({ serviceTiers: [] }, null)).toEqual({ fastMode: false, serviceTier: null })
    expect(codexSpeedSelectionPatch('ultrafast')).toEqual({ fastMode: true, serviceTier: 'ultrafast' })
    expect(codexSpeedSelectionPatch(null)).toEqual({ fastMode: false, serviceTier: null })
  })
})

describe('suggested task speed settings', () => {
  const profile = {
    id: 'codex-base',
    name: 'Codex',
    harnessId: 'codex',
    defaultConfig: {},
    models: [{
      id: 'sol',
      name: 'Sol',
      serviceTiers: [
        { id: 'priority', name: 'Fast', description: '' },
        { id: 'ultrafast', name: 'Ultrafast', description: '' },
      ],
    }, {
      id: 'ultra-only',
      name: 'Ultra only',
      serviceTiers: [{ id: 'ultrafast', name: 'Ultrafast', description: '' }],
    }],
    efforts: [],
    apiProviders: [],
  } as SessionAgentProfile

  it('keeps a listed tier and drops one the model does not advertise', () => {
    expect(suggestedTaskRunSettings(profile, { model: 'sol', serviceTier: 'ultrafast', fastMode: true })).toEqual({
      model: 'sol', serviceTier: 'ultrafast', fastMode: true,
    })
    expect(suggestedTaskRunSettings(profile, { model: 'ultra-only', serviceTier: 'ultrafast', fastMode: true })).toEqual({
      model: 'ultra-only', serviceTier: 'ultrafast',
    })
    expect(suggestedTaskRunSettings(profile, { model: 'sol', serviceTier: 'nope' })).toEqual({ model: 'sol' })
    expect(suggestedTaskRunSettings(profile, { model: 'sol', serviceTier: 'ultrafast' }, false)).toEqual({ model: 'sol' })
  })

  it('accepts a tier id or Standard and rejects an empty tier', () => {
    expect(parseSuggestedTaskChoice({ agentId: 'codex', settings: { serviceTier: 'ultrafast' } })?.settings).toEqual({
      serviceTier: 'ultrafast',
    })
    expect(parseSuggestedTaskChoice({ agentId: 'codex', settings: { serviceTier: null } })?.settings.serviceTier).toBeNull()
    expect(() => parseSuggestedTaskChoice({ agentId: 'codex', settings: { serviceTier: '' } })).toThrow(/serviceTier/)
    expect(() => parseSuggestedTaskChoice({ agentId: 'codex', settings: { serviceTier: '  ' } })).toThrow(/serviceTier/)
  })
})
