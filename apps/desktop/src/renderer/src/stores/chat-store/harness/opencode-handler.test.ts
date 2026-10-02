import { describe, expect, it } from 'vitest'
import type { ModelOption, OpenCodeResources } from '@superone/shared/agent-types'
import type { ChatStore } from '../types'
import { applyOpenCodeResources, resolveDefaultOpenCodeSelection } from './opencode-handler'

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
  it('migrates the legacy Plan preset into a native agent selection once', () => {
    const state = {
      harnessResources: {},
      projectSessions: { '/project': { _activeSessionId: 's', _sessions: { s: {
        sessionProvider: 'opencode', permissionMode: 'plan', openCodeAgentId: 'build',
        selectedModel: 'openai/gpt-5', selectedEffort: 'high',
      } } } },
    } as unknown as ChatStore
    const patch = applyOpenCodeResources(state, { models, agents: [{ id: 'build', name: 'Build' }, { id: 'plan', name: 'Plan' }], commands: [] })
    expect(patch.projectSessions?.['/project']?._sessions.s).toMatchObject({
      permissionMode: 'default', openCodeAgentId: 'plan', selectedModel: 'openai/gpt-5', selectedEffort: 'high',
    })
  })
  it('selects the SDK default model and medium variant', () => {
    expect(resolveDefaultOpenCodeSelection(models)).toEqual({
      modelId: 'openai/gpt-5',
      effort: 'medium',
    })
  })

  it('reconciles stale model and effort selections, leaving the agent to the project list', () => {
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
    // Possibly project-defined: only the session's own list (`session_agents`) can drop it.
    expect(session?.openCodeAgentId).toBe('missing')
    expect(session?.permissionMode).toBe('default')
  })
})
