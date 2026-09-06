import { describe, expect, it } from 'vitest'
import type { ModelOption, RemoteSystemInfo } from '@superone/shared/agent-types'
import {
  effortEasterEgg,
  effortIndexAt,
  effortStopOffset,
  groupModels,
  hasSelectableEffort,
  keepsOpenAfterModelSelect,
  optionParamSummary,
  optionParamsForModel,
} from './model-picker-state'

const claudeModels: ModelOption[] = [
  { id: 'claude-opus-5', name: 'Opus 5', description: 'Deep reasoning', supportedEffortLevels: ['low', 'medium', 'high'] },
  { id: 'claude-haiku-4-5', name: 'Haiku 4.5', description: 'Fast replies' },
]
const openCodeModels: ModelOption[] = [
  { id: 'anthropic/claude-opus-5', name: 'Opus 5', description: '' },
  { id: 'openai/gpt-5.6', name: 'GPT-5.6', description: '' },
]

describe('effort visibility', () => {
  it('only offers effort when there is more than one level', () => {
    expect(hasSelectableEffort([])).toBe(false)
    expect(hasSelectableEffort([{ value: 'medium', label: 'Medium' }])).toBe(false)
    expect(hasSelectableEffort([{ value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }])).toBe(true)
  })
})

describe('model grouping', () => {
  it('groups OpenCode models by their id prefix', () => {
    const groups = groupModels(openCodeModels, { harness: 'opencode' })

    expect(groups.map((group) => group.name)).toEqual(['anthropic', 'openai'])
  })

  it('files every other harness under the active provider name', () => {
    const groups = groupModels(claudeModels, { harness: 'claude', providerName: 'Kimi' })

    expect(groups).toHaveLength(1)
    expect(groups[0]!.name).toBe('Kimi')
    expect(groups[0]!.models).toHaveLength(2)
  })

  it('falls back to the harness display name and filters on the search query', () => {
    const groups = groupModels(claudeModels, { harness: 'claude', query: '  HAIKU ' })

    expect(groups[0]!.name).toBe('Claude')
    expect(groups[0]!.models.map((model) => model.id)).toEqual(['claude-haiku-4-5'])
  })

  it('drops groups that the query empties out', () => {
    expect(groupModels(claudeModels, { harness: 'claude', query: 'nothing' })).toEqual([])
  })
})

describe('keeping the menu open after a model switch', () => {
  const info: RemoteSystemInfo = { models: claudeModels }

  it('stays open when the new model still has effort to tune', () => {
    expect(keepsOpenAfterModelSelect('claude', info, 'claude-opus-5')).toBe(true)
  })

  it('closes when the new model has no effort of its own', () => {
    expect(keepsOpenAfterModelSelect('claude', info, 'claude-haiku-4-5')).toBe(false)
  })

  it('closes for mapped providers, which own the effort themselves', () => {
    const mapped: RemoteSystemInfo = {
      ...info,
      activeProvider: { id: 'kimi', name: 'Kimi', presetKey: null, modelEnv: { default: { id: 'kimi-k2' } }, forcedEffort: null },
    }

    expect(keepsOpenAfterModelSelect('claude', mapped, 'claude-opus-5')).toBe(false)
  })

  it('reads harness-wide efforts for ACP, which are not per model', () => {
    const acp: RemoteSystemInfo = {
      models: [{ id: 'grok', name: 'Grok', description: '' }],
      efforts: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }],
    }

    expect(keepsOpenAfterModelSelect('acp', acp, 'grok')).toBe(true)
  })
})

describe('effort slider geometry', () => {
  // A 300pt track with a 28pt thumb leaves 272pt of travel, inset by 14pt.
  it('lands the first and last stop under the thumb centre', () => {
    expect(effortStopOffset(0, 3, 300, 28)).toBe(14)
    expect(effortStopOffset(2, 3, 300, 28)).toBe(286)
    expect(effortStopOffset(1, 3, 300, 28)).toBe(150)
  })

  it('parks a single stop at the inset before layout reports a width', () => {
    expect(effortStopOffset(0, 1, 300, 28)).toBe(14)
    expect(effortStopOffset(1, 3, 0, 28)).toBe(14)
  })

  it('snaps a touch to the nearest stop and clamps past the ends', () => {
    expect(effortIndexAt(14, 3, 300, 28)).toBe(0)
    expect(effortIndexAt(150, 3, 300, 28)).toBe(1)
    expect(effortIndexAt(220, 3, 300, 28)).toBe(2)
    expect(effortIndexAt(-40, 3, 300, 28)).toBe(0)
    expect(effortIndexAt(999, 3, 300, 28)).toBe(2)
  })

  it('returns the only stop when there is nowhere to travel', () => {
    expect(effortIndexAt(120, 1, 300, 28)).toBe(0)
    expect(effortIndexAt(120, 3, 0, 28)).toBe(0)
  })
})

describe('option params', () => {
  const codexModel: ModelOption = {
    id: 'gpt-5.6', name: 'GPT-5.6', description: '',
    serviceTiers: [{ id: 'priority', name: 'Fast', description: 'Faster responses' }],
  }
  const cursorModel: ModelOption = {
    id: 'cursor-1', name: 'Cursor 1', description: '',
    parameters: [
      { id: 'effort', values: [{ value: 'low' }, { value: 'high' }] },
      { id: 'thinking', values: [{ value: 'true' }, { value: 'false' }] },
      { id: 'optimize_for', values: [{ value: 'balanced' }, { value: 'speed', displayName: 'Speed' }] },
    ],
  }

  it('offers Codex Fast as a toggle that reflects the selected service tier', () => {
    expect(optionParamsForModel('codex', codexModel)).toEqual([{
      id: 'fast', label: 'Fast', kind: 'toggle',
      values: [{ value: 'false', label: 'Off' }, { value: 'true', label: 'On' }],
      selected: 'false',
    }])
    expect(optionParamsForModel('codex', codexModel, { serviceTier: 'priority' })[0]!.selected).toBe('true')
  })

  it('leaves Codex alone when the model ships no Fast tier', () => {
    expect(optionParamsForModel('codex', { id: 'o', name: 'O', description: '' })).toEqual([])
  })

  it('keeps the Cursor effort param out of Options — it is already the slider', () => {
    const params = optionParamsForModel('cursor', cursorModel)

    expect(params.map((param) => param.id)).toEqual(['thinking', 'optimize_for'])
    expect(params[0]!.kind).toBe('toggle')
    expect(params[1]!.kind).toBe('choice')
    expect(params[1]!.selected).toBe('balanced')
  })

  it('hides catalog params for a harness whose send path would drop them', () => {
    expect(optionParamsForModel('claude', cursorModel)).toEqual([])
  })

  it('summarises only a non-default optimize_for in the trigger', () => {
    expect(optionParamSummary(optionParamsForModel('cursor', cursorModel))).toEqual([])
    expect(optionParamSummary(optionParamsForModel('cursor', cursorModel, { params: { optimize_for: 'speed' } })))
      .toEqual(['Speed'])
  })
})

describe('OpenCode reached through ACP', () => {
  it('groups the slash-prefixed catalog the way the desktop does', () => {
    const groups = groupModels(openCodeModels, { harness: 'acp', acpAgentId: 'opencode' })

    expect(groups.map((group) => group.name)).toEqual(['anthropic', 'openai'])
  })

  it('leaves another ACP agent under one heading', () => {
    expect(groupModels(openCodeModels, { harness: 'acp', acpAgentId: 'grok' })).toHaveLength(1)
  })
})

describe('effort easter eggs', () => {
  const claudeEfforts = [
    { value: 'low', label: 'Low' },
    { value: 'xhigh', label: 'Extra High' },
    { value: 'max', label: 'Max' },
  ]

  it('burns on max and goes rainbow on xhigh, for Claude only', () => {
    expect(effortEasterEgg('claude', 'max', claudeEfforts)).toBe('max')
    expect(effortEasterEgg('claude', 'xhigh', claudeEfforts)).toBe('xhigh')
    expect(effortEasterEgg('claude', 'low', claudeEfforts)).toBe(null)
    expect(effortEasterEgg('codex', 'max', claudeEfforts)).toBe(null)
  })

  it('stays quiet when effort is not a real choice', () => {
    expect(effortEasterEgg('claude', 'max', [{ value: 'max', label: 'Max' }])).toBe(null)
  })
})
