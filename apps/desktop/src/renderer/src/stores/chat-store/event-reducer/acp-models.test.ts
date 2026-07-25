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

const grokModels: ModelOption[] = [
  { id: 'grok-4.5', name: 'Grok 4.5', description: '' },
  { id: 'composer', name: 'Composer', description: '' },
]
const openCodeModels: ModelOption[] = [
  { id: 'openai/gpt-5.4', name: 'OpenAI/GPT-5.4', description: '' },
  { id: 'opencode/big-pickle', name: 'OpenCode Zen/Big Pickle', description: '' },
]

describe('applyEventToSession: acp_models', () => {
  it('hydrates models and default selection when agent matches', () => {
    const session = {
      ...createDefaultPerSessionState(),
      preferredProvider: 'acp' as const,
      sessionProvider: 'acp' as const,
      acpAgentId: 'opencode',
    }
    const patch = applyEventToSession(session, {
      type: 'acp_models',
      agentId: 'opencode',
      models: openCodeModels,
      selectedModelId: 'opencode/big-pickle',
      configId: 'model',
      status: 'ready',
    })
    expect(patch.acpModels).toEqual(openCodeModels)
    expect(patch.selectedModel).toBe('opencode/big-pickle')
    expect(patch.acpModelsStatus).toBe('ready')
    expect(patch.acpModelConfigId).toBe('model')
  })

  it('drops catalogs from a different ACP agent (stale prewarm race)', () => {
    const session = {
      ...createDefaultPerSessionState(),
      preferredProvider: 'acp' as const,
      sessionProvider: 'acp' as const,
      acpAgentId: 'opencode',
      acpModels: openCodeModels,
      acpModelsStatus: 'ready' as const,
      selectedModel: 'opencode/big-pickle',
    }
    const patch = applyEventToSession(session, {
      type: 'acp_models',
      agentId: 'grok-build',
      models: grokModels,
      selectedModelId: 'grok-4.5',
      configId: null,
      status: 'ready',
    })
    expect(patch).toEqual({})
  })

  it('ignores ACP model events after switching harness (stale prewarm)', () => {
    const session = {
      ...createDefaultPerSessionState(),
      preferredProvider: 'claude' as const,
      sessionProvider: 'claude' as const,
      // Kept for when the user switches back to ACP
      acpAgentId: 'grok-build',
      selectedModel: 'claude-sonnet-4',
      modelUserChosen: false,
    }
    const patch = applyEventToSession(session, {
      type: 'acp_models',
      agentId: 'grok-build',
      models: grokModels,
      selectedModelId: 'grok-4.5',
      configId: null,
      status: 'ready',
    })
    expect(patch).toEqual({})
  })

  it('ignores ACP mode events when harness is not acp', () => {
    const session = {
      ...createDefaultPerSessionState(),
      preferredProvider: 'opencode' as const,
      sessionProvider: 'opencode' as const,
      acpAgentId: 'grok-build',
      selectedModel: 'openai/gpt-5',
    }
    const patch = applyEventToSession(session, {
      type: 'acp_modes',
      agentId: 'grok-build',
      modes: [{ id: 'high', name: 'High', description: '' }],
      selectedModeId: 'high',
      configId: null,
      status: 'ready',
    })
    expect(patch).toEqual({})
  })

  it('does not wipe ready cache while a loading event arrives', () => {
    const session = {
      ...createDefaultPerSessionState(),
      preferredProvider: 'acp' as const,
      sessionProvider: 'acp' as const,
      acpAgentId: 'opencode',
      acpModels: openCodeModels,
      acpModelsStatus: 'ready' as const,
      selectedModel: 'openai/gpt-5.4',
    }
    const patch = applyEventToSession(session, {
      type: 'acp_models',
      agentId: 'opencode',
      models: [],
      selectedModelId: null,
      configId: null,
      status: 'loading',
    })
    expect(patch).toEqual({})
  })

  it('preserves user-chosen model when still in the catalog', () => {
    const session = {
      ...createDefaultPerSessionState(),
      preferredProvider: 'acp' as const,
      sessionProvider: 'acp' as const,
      acpAgentId: 'opencode',
      selectedModel: 'openai/gpt-5.4',
      modelUserChosen: true,
    }
    const patch = applyEventToSession(session, {
      type: 'acp_models',
      agentId: 'opencode',
      models: openCodeModels,
      selectedModelId: 'opencode/big-pickle',
      configId: 'model',
      status: 'ready',
    })
    expect(patch.acpModels).toEqual(openCodeModels)
    expect(patch.selectedModel).toBeUndefined()
  })

  it('resets selection when user-chosen model is no longer in catalog', () => {
    const session = {
      ...createDefaultPerSessionState(),
      preferredProvider: 'acp' as const,
      sessionProvider: 'acp' as const,
      acpAgentId: 'opencode',
      selectedModel: 'stale-model',
      modelUserChosen: true,
    }
    const patch = applyEventToSession(session, {
      type: 'acp_models',
      agentId: 'opencode',
      models: openCodeModels,
      selectedModelId: 'opencode/big-pickle',
      configId: 'model',
      status: 'ready',
    })
    expect(patch.selectedModel).toBe('opencode/big-pickle')
  })
})
