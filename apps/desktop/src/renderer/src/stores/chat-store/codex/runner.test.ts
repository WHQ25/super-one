import { describe, expect, it, vi } from 'vitest'
import { createDefaultChatCoreSession, reduceMessageComplete, reduceUsage } from '@superone/chat-core'
import type { CodexUsageInfo } from '@superone/shared/agent-types'
import type { ChatStore, PerSessionState } from '../types'

vi.mock('../helpers/codex-helpers', async () => ({
  ...await import('@superone/chat-core'),
  getLatestCodexThreadId: () => null,
  pruneTransientCodexItems: (items: unknown[]) => items,
}))
vi.mock('../helpers/persistence', () => ({ _getSessionCwd: () => '/test' }))
vi.mock('../helpers/store-helpers', () => {
  const updatePerSession = (state: ChatStore, path: string, id: string, update: (session: PerSessionState) => Partial<PerSessionState>) => {
    const project = state.projectSessions[path]
    return { projectSessions: { ...state.projectSessions, [path]: {
      ...project,
      _sessions: { ...project._sessions, [id]: { ...project._sessions[id], ...update(project._sessions[id]) } },
    } } }
  }
  return {
    getProject: (state: ChatStore, path: string) => state.projectSessions[path],
    mergeCallerScopedDirs: () => [],
    updatePerSession,
    updateActivePerSession: (state: ChatStore, update: (session: PerSessionState) => Partial<PerSessionState>) =>
      updatePerSession(state, '/test', 'session-1', update),
  }
})

const { runCodexCommand } = await import('./runner')

describe('Codex run completion token accounting', () => {
  it.each([true, false])('preserves whole-turn tokens when completion event arrives before IPC result: %s', async (completeBeforeResult) => {
    let state = {
      projectSessions: { '/test': {
        _activeSessionId: 'session-1',
        _sessions: { 'session-1': { ...createDefaultChatCoreSession(), additionalDirs: [] } },
      } },
    } as unknown as ChatStore
    const getSession = () => state.projectSessions['/test']._sessions['session-1']
    const setSession = (patch: Partial<PerSessionState>) => Object.assign(getSession(), patch)
    const first: CodexUsageInfo = {
      totalInputTokens: 10000, totalCachedInputTokens: 2000, totalOutputTokens: 4000,
      lastInputTokens: 10000, lastCachedInputTokens: 2000, lastOutputTokens: 4000,
      reasoningOutputTokens: 0, contextWindow: 200000,
    }
    const last: CodexUsageInfo = {
      ...first, totalInputTokens: 22000, totalCachedInputTokens: 13000, totalOutputTokens: 4200,
      lastInputTokens: 12000, lastCachedInputTokens: 11000, lastOutputTokens: 200,
    }
    vi.stubGlobal('window', { app: { codexRun: vi.fn(async () => {
      const messageId = getSession().messages[0].id
      for (const usage of [first, last]) {
        setSession(reduceUsage(getSession(), {
          type: 'message_usage', messageId, inputTokens: usage.lastInputTokens,
          outputTokens: usage.lastOutputTokens, codexUsage: usage,
        }))
      }
      expect(getSession().streamingTokens).toEqual({ input: 9000, output: 4200 })
      if (completeBeforeResult) {
        setSession(reduceMessageComplete(getSession(), {
          type: 'message_complete', messageId,
          metadata: { codex: { threadId: 'thread-1', usage: last, items: [] } },
        }))
        expect(getSession().streamingTokens).toEqual({ input: 0, output: 0 })
      }
      return { threadId: 'thread-1', finalResponse: 'done', usage: last, items: [] }
    }) } })
    try {
      await runCodexCommand((update) => {
        state = { ...state, ...(typeof update === 'function' ? update(state) : update) }
      }, () => state, {
        activeProject: '/test', codexSessionId: 'session-1', session: getSession(),
        codexCommand: { kind: 'run', prompt: 'test' }, finalContent: 'test',
        userMessageId: 'user-1', attachments: [], selectedCodexPermissionPreset: 'default',
        collaborationMode: 'default',
      })
      expect(getSession().messages[0].metadata?.consumedTokens).toEqual({ input: 9000, output: 4200 })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
