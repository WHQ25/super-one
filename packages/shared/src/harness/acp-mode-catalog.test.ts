import { describe, expect, it } from 'vitest'
import type { ModelOption } from '../agent-types'
import { acpModeCatalog } from './acp-mode-catalog'

function mode(id: string, name: string, description = ''): ModelOption {
  return { id, name, description }
}

describe('ACP mode catalog', () => {
  it('reads Grok extraModes as effort, ascending and without the repeated noun', () => {
    const projection = acpModeCatalog({
      modeConfigId: null,
      selectedModeId: 'high',
      modes: [mode('high', 'High Effort'), mode('low', 'Low Effort'), mode('medium', 'Medium Effort')],
    })

    expect(projection.efforts.map((option) => option.value)).toEqual(['low', 'medium', 'high'])
    expect(projection.efforts.map((option) => option.label)).toEqual(['Low', 'Medium', 'High'])
    expect(projection.modes).toEqual([])
  })

  it('reads Grok reasoning_effort as effort after the session config id is set', () => {
    const projection = acpModeCatalog({
      modeConfigId: 'reasoning_effort',
      selectedModeId: 'high',
      modes: [mode('high', 'High'), mode('low', 'Low')],
    })

    expect(projection.efforts.map((option) => option.value)).toEqual(['low', 'high'])
    expect(projection.modes).toEqual([])
  })

  it('keeps real session modes out of effort, so the client does not draw a slider for them', () => {
    const projection = acpModeCatalog({
      modeConfigId: 'mode-config',
      selectedModeId: 'code',
      modes: [mode('ask', 'Ask'), mode('code', 'Code', 'Edit files directly')],
    })

    expect(projection.efforts).toEqual([])
    expect(projection.modes).toEqual([
      { id: 'ask', name: 'Ask' },
      { id: 'code', name: 'Code', description: 'Edit files directly' },
    ])
    expect(projection.selectedModeId).toBe('code')
  })

  it('falls back to the first mode when the agent named no selection', () => {
    const projection = acpModeCatalog({
      modeConfigId: 'mode-config',
      selectedModeId: null,
      modes: [mode('ask', 'Ask'), mode('code', 'Code')],
    })

    expect(projection.selectedModeId).toBe('ask')
  })

  it('projects nothing for an agent with no modes at all', () => {
    expect(acpModeCatalog(null)).toEqual({ efforts: [], modes: [], selectedModeId: null })
  })
})
