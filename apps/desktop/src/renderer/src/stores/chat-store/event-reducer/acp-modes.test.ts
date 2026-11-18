/** @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest'
import type { ModelOption } from '@superone/shared/agent-types'

vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ sandboxCapability: null }) } }))
vi.mock('@/stores/activity-view-state', () => ({ useActivityViewStateStore: { getState: () => ({}) } }))
vi.stubGlobal('window', {
  agent: new Proxy({}, { get: () => () => Promise.resolve(undefined) }),
  app: { trace: vi.fn(), getAppSettings: vi.fn().mockResolvedValue({ agentPreference: {} }) },
})

await import('../index')
const { createDefaultPerSessionState } = await import('../defaults')
const { applyEventToSession } = await import('./index')

const modes: ModelOption[] = [
  { id: 'ask', name: 'Ask', description: 'prompt first' },
  { id: 'code', name: 'Code', description: 'full access' },
]

describe('applyEventToSession: acp_modes', () => {
  it('hydrates modes and selection when agent matches', () => {
    const session = {
      ...createDefaultPerSessionState(),
      preferredProvider: 'acp-grok' as const,
      sessionProvider: 'acp-grok' as const,
      acpAgentId: 'opencode',
    }
    const patch = applyEventToSession(session, {
      type: 'acp_modes',
      agentId: 'opencode',
      modes,
      selectedModeId: 'code',
      configId: 'mode',
      status: 'ready',
    })
    expect(patch.acpModes).toEqual(modes)
    expect(patch.selectedAcpModeId).toBe('code')
    expect(patch.acpModeConfigId).toBe('mode')
    expect(patch.acpModesStatus).toBe('ready')
  })

  it('drops catalogs from a different ACP agent', () => {
    const session = {
      ...createDefaultPerSessionState(),
      preferredProvider: 'acp-grok' as const,
      sessionProvider: 'acp-grok' as const,
      acpAgentId: 'opencode',
      acpModes: modes,
      selectedAcpModeId: 'code',
      acpModesStatus: 'ready' as const,
    }
    const patch = applyEventToSession(session, {
      type: 'acp_modes',
      agentId: 'grok-build',
      modes: [{ id: 'default', name: 'Default', description: '' }],
      selectedModeId: 'default',
      configId: 'mode',
      status: 'ready',
    })
    expect(patch).toEqual({})
  })

  it('does not wipe ready modes while loading', () => {
    const session = {
      ...createDefaultPerSessionState(),
      preferredProvider: 'acp-grok' as const,
      sessionProvider: 'acp-grok' as const,
      acpAgentId: 'opencode',
      acpModes: modes,
      selectedAcpModeId: 'ask',
      acpModesStatus: 'ready' as const,
    }
    const patch = applyEventToSession(session, {
      type: 'acp_modes',
      agentId: 'opencode',
      modes: [],
      selectedModeId: null,
      configId: null,
      status: 'loading',
    })
    expect(patch).toEqual({})
  })

  it('applies agent-initiated mode updates', () => {
    const session = {
      ...createDefaultPerSessionState(),
      preferredProvider: 'acp-grok' as const,
      sessionProvider: 'acp-grok' as const,
      acpAgentId: 'opencode',
      acpModes: modes,
      selectedAcpModeId: 'ask',
      acpModesStatus: 'ready' as const,
    }
    const patch = applyEventToSession(session, {
      type: 'acp_modes',
      agentId: 'opencode',
      modes,
      selectedModeId: 'code',
      configId: 'mode',
      status: 'ready',
    })
    expect(patch.selectedAcpModeId).toBe('code')
  })

  it('keeps existing valid effort when agent advertises its own default thought_level', () => {
    const effortModes: ModelOption[] = [
      { id: 'low', name: 'Low', description: '' },
      { id: 'medium', name: 'Medium', description: '' },
      { id: 'high', name: 'High', description: '' },
      { id: 'xhigh', name: 'Extra', description: '' },
    ]
    const session = {
      ...createDefaultPerSessionState(),
      preferredProvider: 'acp-antigravity' as const,
      sessionProvider: 'acp-antigravity' as const,
      acpAgentId: 'antigravity',
      acpModels: [
        {
          id: 'gemini-4-hydrogen',
          name: 'Gemini 4 Hydrogen',
          description: '',
          supportsEffort: true,
          supportedEffortLevels: ['low', 'medium', 'high', 'xhigh'],
        },
      ] as ModelOption[],
      selectedModel: 'gemini-4-hydrogen',
      acpModes: effortModes,
      acpModeConfigId: 'thought_level',
      selectedAcpModeId: 'medium',
      acpModesStatus: 'ready' as const,
    }
    const patch = applyEventToSession(session, {
      type: 'acp_modes',
      agentId: 'antigravity',
      modes: effortModes,
      selectedModeId: 'high',
      configId: 'thought_level',
      status: 'ready',
    })
    expect(patch.selectedAcpModeId).toBeUndefined()
  })
})
