import { describe, expect, it } from 'vitest'
import {
  agentProfileOptionRows,
  agentProfileOptionsForModel,
  setAgentProfileOptionRow,
  type AgentProfileOptionCatalog,
} from './agent-profile-options'

const LABELS = { field: (key: string) => key, userDefault: 'Default', on: 'On', off: 'Off' }

const CLAUDE: AgentProfileOptionCatalog = {
  models: [{ id: 'sonnet', supportedEffortLevels: ['high'] }, { id: 'opus', supportedEffortLevels: ['high', 'xhigh'] }],
}
const GROK: AgentProfileOptionCatalog = {
  models: [{ id: 'grok-4', contextWindows: [256_000, 1_000_000] }, { id: 'grok-code', contextWindows: [256_000] }],
  host: { lists: { mode: [{ value: 'plan', label: 'Plan' }] } },
}
const CURSOR: AgentProfileOptionCatalog = {
  models: [{
    id: 'opus',
    parameters: [{ id: 'context', displayName: 'Context', values: [{ value: '200k' }, { value: '1m' }] }],
  }],
}

describe('agentProfileOptionRows', () => {
  it('offers a toggle only on a model that carries it, showing the launch default when unset', () => {
    expect(agentProfileOptionRows('claude', CLAUDE, 'sonnet', undefined, undefined, LABELS)).toEqual([])
    expect(agentProfileOptionRows('claude', CLAUDE, 'opus', undefined, { ultracode: true }, LABELS)).toEqual([{
      id: 'ultracode', label: 'ultracode', kind: 'toggle',
      values: [{ value: 'false', label: 'Off' }, { value: 'true', label: 'On' }], selected: 'true',
    }])
  })

  it('lists choices with a user-default entry, and one row per Cursor parameter', () => {
    const rows = agentProfileOptionRows('acp', GROK, 'grok-4', { contextWindow: 1_000_000 }, undefined, LABELS)
    expect(rows.map((row) => [row.id, row.selected, row.values.map((value) => value.value)])).toEqual([
      ['contextWindow', '1000000', ['', '256000', '1000000']],
      ['mode', '', ['', 'plan']],
    ])
    expect(agentProfileOptionRows('cursor', CURSOR, 'opus', { modelParams: { context: '1m' } }, undefined, LABELS))
      .toMatchObject([{ id: 'modelParams.context', kind: 'choice', selected: '1m' }])
  })
})

describe('setAgentProfileOptionRow', () => {
  it('writes each kind back as its own type and clears an empty choice', () => {
    expect(setAgentProfileOptionRow(undefined, 'ultracode', 'true')).toEqual({ ultracode: true })
    expect(setAgentProfileOptionRow({ mode: 'plan' }, 'contextWindow', '256000')).toEqual({ mode: 'plan', contextWindow: 256_000 })
    expect(setAgentProfileOptionRow({ mode: 'plan' }, 'mode', '')).toBeUndefined()
    expect(setAgentProfileOptionRow({ modelParams: { fast: 'true' } }, 'modelParams.context', '1m'))
      .toEqual({ modelParams: { fast: 'true', context: '1m' } })
    expect(setAgentProfileOptionRow({ mode: 'plan' }, 'unknown', 'x')).toEqual({ mode: 'plan' })
  })
})

describe('agentProfileOptionsForModel', () => {
  it('drops what the new model cannot carry and keeps harness-wide options', () => {
    expect(agentProfileOptionsForModel('acp', GROK, 'grok-code', { contextWindow: 1_000_000, mode: 'plan' })).toEqual({ mode: 'plan' })
    expect(agentProfileOptionsForModel('claude', CLAUDE, 'sonnet', { ultracode: true })).toBeUndefined()
    expect(agentProfileOptionsForModel('claude', CLAUDE, 'unlisted', { ultracode: true })).toEqual({ ultracode: true })
  })
})
