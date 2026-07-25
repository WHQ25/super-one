import { describe, expect, it } from 'vitest'
import type { ModelOption, OpenCodeResources } from '@superone/shared/agent-types'
import type { ChatStore } from '../types'
import { applyOpenCodeResources, resolveDefaultOpenCodeAgent, resolveDefaultOpenCodeSelection } from './opencode-handler'

const models: ModelOption[] = [
  {
    id: 'anthropic/claude',
    name: 'Claude',
    description: '',
    supportedEffortLevels: ['high'],
  },
  {
    id: 'openai/gpt-5',
    name: 'GPT-5',
    description: '',
    isDefault: true,
    supportedEffortLevels: ['low', 'medium', 'high'],
  },
]

describe('opencode-handler', () => {
  it('selects the SDK default model and medium variant', () => {
    expect(resolveDefaultOpenCodeSelection(models)).toEqual({
      modelId: 'openai/gpt-5',
      effort: 'medium',
    })
  })

  it('prefers build and falls back to the first primary agent', () => {
    expect(resolveDefaultOpenCodeAgent([
      { id: 'general', name: 'general' },
      { id: 'build', name: 'build' },
    ])).toBe('build')
    expect(resolveDefaultOpenCodeAgent([{ id: 'general', name: 'general' }])).toBe('general')
  })

  it('reconciles stale model and effort selections', () => {
    const resources: OpenCodeResources = {
      models,
      agents: [{ id: 'build', name: 'build' }, { id: 'general', name: 'general' }],
      commands: [],
    }
    const state = {
      harnessResources: { claude: null, codex: null, acp: null, opencode: null, cursor: null },
      projectSessions: {
        '/project': {
          _activeSessionId: 'session',
          _sessions: {
            session: {
              sessionProvider: 'opencode',
              preferredProvider: 'opencode',
              selectedModel: 'missing/model',
              selectedEffort: 'xhigh',
              openCodeAgentId: 'missing',
            },
          },
        },
      },
    } as unknown as ChatStore

    const patch = applyOpenCodeResources(state, resources)
    const session = patch.projectSessions?.['/project']?._sessions.session
    expect(session?.selectedModel).toBe('openai/gpt-5')
    expect(session?.selectedEffort).toBe('medium')
    expect(session?.openCodeAgentId).toBe('build')
  })
})
