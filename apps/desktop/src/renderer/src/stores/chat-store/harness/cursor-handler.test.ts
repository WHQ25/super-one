import { describe, expect, it } from 'vitest'
import type { CursorResources, EffortLevel, ModelOption } from '@superone/shared/agent-types'
import type { ChatStore } from '../types'
import { applyCursorResources, enabledCursorModels, resolveDefaultCursorSelection } from './cursor-handler'

const models: ModelOption[] = [
  {
    id: 'claude-sonnet-4-5',
    name: 'Sonnet',
    description: '',
    supportedEffortLevels: ['low', 'medium', 'high'],
  },
  {
    id: 'gpt-5',
    name: 'GPT-5',
    description: '',
    isDefault: true,
    supportedEffortLevels: ['medium', 'high'],
  },
]

function storeWithCursorSession(session: {
  selectedModel: string
  selectedEffort?: EffortLevel
}): ChatStore {
  return {
    harnessResources: { claude: null, codex: null, acp: null, opencode: null, cursor: null },
    projectSessions: {
      '/project': {
        _activeSessionId: 'session',
        _sessions: {
          session: {
            sessionProvider: 'cursor',
            preferredProvider: 'cursor',
            ...session,
          },
        },
      },
    },
  } as unknown as ChatStore
}

describe('cursor-handler', () => {
  it('returns the same empty-array reference when Cursor resources are missing', () => {
    expect(enabledCursorModels(null)).toBe(enabledCursorModels(undefined))
    expect(enabledCursorModels(null)).toEqual([])
  })

  it('selects the SDK default model and medium variant', () => {
    expect(resolveDefaultCursorSelection(models)).toEqual({
      modelId: 'gpt-5',
      effort: 'medium',
    })
  })

  it('does not rewrite Cursor sessions when an empty catalog cannot change the selection', () => {
    const empty: CursorResources = { models: [] }
    const state = storeWithCursorSession({ selectedModel: '', selectedEffort: undefined })
    const patch = applyCursorResources(state, empty)
    expect(patch.projectSessions).toBeUndefined()
    expect(patch.harnessResources?.cursor).toEqual(empty)
  })

  it('clears a stale model when the catalog is empty', () => {
    const empty: CursorResources = { models: [] }
    const state = storeWithCursorSession({ selectedModel: 'gone', selectedEffort: 'high' })
    const patch = applyCursorResources(state, empty)
    const session = patch.projectSessions?.['/project']?._sessions.session
    expect(session?.selectedModel).toBe('')
    expect(session?.selectedEffort).toBeUndefined()
  })

  it('reconciles stale model and effort selections against a live catalog', () => {
    const resources: CursorResources = { models }
    const state = storeWithCursorSession({ selectedModel: 'missing', selectedEffort: 'xhigh' })
    const patch = applyCursorResources(state, resources)
    const session = patch.projectSessions?.['/project']?._sessions.session
    expect(session?.selectedModel).toBe('gpt-5')
    expect(session?.selectedEffort).toBe('medium')
  })

  it('keeps a valid selection without minting a new session object', () => {
    const resources: CursorResources = { models }
    const state = storeWithCursorSession({ selectedModel: 'gpt-5', selectedEffort: 'medium' })
    const patch = applyCursorResources(state, resources)
    expect(patch.projectSessions).toBeUndefined()
  })
})
