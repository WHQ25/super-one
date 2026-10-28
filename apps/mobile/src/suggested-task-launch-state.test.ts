import { describe, expect, it } from 'vitest'
import { suggestedTaskOptions as options } from './screens/suggested-task-launch-fixtures'
import { patchSuggestedTaskSettings, suggestedTaskEfforts, suggestedTaskLaunchView } from './suggested-task-launch-state'

const claude = options.profiles[0]!
const codex = options.profiles[1]!

describe('suggested task launch view', () => {
  it('keeps effort for an official Claude credential and offers Fast on a supported model', () => {
    const view = suggestedTaskLaunchView(claude, { ...claude.defaultConfig, ...options.initial.settings })
    expect(view.efforts.map((effort) => effort.value)).toEqual(['low', 'high'])
    expect(view.optionParams.map((param) => param.id)).toEqual(['claudeFastMode'])
    expect(view.providerId).toBe('official')
  })

  it('hides effort when the Claude credential remaps the catalog', () => {
    expect(suggestedTaskEfforts(claude, 'opus', 'gateway')).toEqual([])
  })

  it('offers Codex Fast only for a model that advertises the tier', () => {
    const basic = suggestedTaskLaunchView(codex, codex.defaultConfig)
    const other = suggestedTaskLaunchView(codex, { ...codex.defaultConfig, model: 'gpt-other' })
    expect(basic.optionParams).toEqual([])
    expect(other.optionParams.map((param) => param.id)).toEqual(['fast'])
    expect(other.efforts.map((effort) => effort.value)).toEqual(['low', 'medium'])
  })

  it('clamps effort to the new model and turns Fast off when that model has no tier', () => {
    const next = patchSuggestedTaskSettings(codex, { fastMode: true, effort: 'medium' }, { model: 'gpt-other', effort: 'medium', fastMode: true }, { model: 'gpt-basic' })
    expect(next).toEqual({ model: 'gpt-basic', effort: 'low', fastMode: false, serviceTier: null })
  })

  it('keeps Ultrafast when the next model lists it and clears it when the next model does not', () => {
    const tiers = [
      { id: 'priority', name: 'Fast', description: '' },
      { id: 'ultrafast', name: 'Ultrafast', description: '' },
    ]
    const profile = {
      ...codex,
      models: [
        ...codex.models,
        { id: 'gpt-ultra', name: 'Ultra', serviceTiers: tiers },
        { id: 'gpt-ultra-2', name: 'Ultra 2', serviceTiers: tiers },
      ],
    }
    const displayed = { model: 'gpt-ultra', serviceTier: 'ultrafast', fastMode: true }
    const kept = patchSuggestedTaskSettings(profile, displayed, displayed, { model: 'gpt-ultra-2' })
    expect(kept.serviceTier).toBe('ultrafast')
    expect(kept.fastMode).toBe(true)
    const cleared = patchSuggestedTaskSettings(profile, displayed, displayed, { model: 'gpt-other' })
    expect(cleared.serviceTier).toBeNull()
    expect(cleared.fastMode).toBe(false)
    const view = suggestedTaskLaunchView(profile, displayed)
    expect(view.optionParams[0]).toMatchObject({ id: 'serviceTier', selected: 'ultrafast' })
  })

  it('drops effort when switching onto a mapped Claude credential', () => {
    const next = patchSuggestedTaskSettings(claude, { model: 'opus', effort: 'high', claudeFastMode: true }, { ...claude.defaultConfig, model: 'opus', effort: 'high', claudeFastMode: true }, { apiProviderId: 'gateway' })
    expect(next.effort).toBeUndefined()
    expect(next.claudeFastMode).toBe(false)
    expect(next.apiProviderId).toBe('gateway')
  })
})
