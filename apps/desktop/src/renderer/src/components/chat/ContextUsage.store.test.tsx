/** @vitest-environment jsdom */

/**
 * Regression: `useChatStore(s => s.harnessResources.cursor?.models ?? [])`
 * minted a new [] whenever Cursor was unloaded. React 19's
 * useSyncExternalStore treated every snapshot as a change and hit #185
 * (Maximum update depth exceeded), blanking the window on boot — the
 * stack Windows users reported pointed at ContextUsage inside ChatInput.
 *
 * Existing ContextUsage.test.tsx mocks the store as a plain function, so
 * it cannot see this loop. This file uses the real Zustand store.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/hooks/useModelCatalog', () => ({
  useModelCatalog: () => ({
    catalog: null,
    loading: false,
    refreshing: false,
    refresh: async () => {},
  }),
}))

import { ContextUsage } from './ContextUsage'
import { useChatStore } from '@/stores/chat'

/** Packaged Windows project path — the original report came from this shape. */
const WIN_PATH = 'C:\\Users\\chenyue\\Projects\\demo'

function seedSession(tokens = 0): void {
  useChatStore.setState({
    harnessResources: { claude: null, codex: null, acp: null, opencode: null, cursor: null },
    claudeResourcesLoading: false,
  })
  useChatStore.getState().ensureSession(WIN_PATH)
  useChatStore.setState({ activeProject: WIN_PATH })
  if (tokens > 0) {
    const sid = useChatStore.getState().projectSessions[WIN_PATH]?._activeSessionId
    if (sid) {
      useChatStore.getState().setDetailedUsage(WIN_PATH, sid, null)
      useChatStore.setState((s) => {
        const project = s.projectSessions[WIN_PATH]
        const session = project?._sessions[sid]
        if (!project || !session) return s
        return {
          projectSessions: {
            ...s.projectSessions,
            [WIN_PATH]: {
              ...project,
              _sessions: {
                ...project._sessions,
                [sid]: { ...session, contextTokens: tokens, totalCostUsd: 0.01 },
              },
            },
          },
        }
      })
    }
  }
}

afterEach(() => {
  cleanup()
})

describe('ContextUsage with an unloaded Cursor catalog', () => {
  it('mounts without React #185 when Cursor models are missing', () => {
    seedSession(12_000)

    expect(() => render(<ContextUsage />)).not.toThrow()
  })

  it('survives the burst of store ticks that happen during Windows boot', () => {
    seedSession(12_000)
    render(<ContextUsage />)

    expect(() => {
      act(() => {
        for (let i = 0; i < 60; i++) {
          useChatStore.setState({ claudeResourcesLoading: i % 2 === 0 })
        }
      })
    }).not.toThrow()
  })
})

describe('ContextUsage when switching an empty session to another harness', () => {
  it.each(['claude', 'codex', 'opencode', 'cursor', 'dsh'] as const)(
    'hides Grok initialization usage after switching to %s',
    async (provider) => {
      useChatStore.setState({ projectSessions: {}, activeProject: null })
      seedSession()
      useChatStore.setState({ initializedHarnesses: new Set([provider]) })
      const sid = useChatStore.getState().projectSessions[WIN_PATH]._activeSessionId!
      useChatStore.setState((state) => {
        const project = state.projectSessions[WIN_PATH]
        return {
          projectSessions: {
            ...state.projectSessions,
            [WIN_PATH]: {
              ...project,
              _sessions: {
                ...project._sessions,
                [sid]: {
                  ...project._sessions[sid],
                  sessionProvider: 'acp',
                  preferredProvider: 'acp',
                  acpAgentId: 'grok-build',
                },
              },
            },
          },
        }
      })
      useChatStore.getState().handleAgentEvent({
        type: 'message_usage',
        projectPath: WIN_PATH,
        sessionId: sid,
        messageId: 'acp_session_grok',
        inputTokens: 0,
        outputTokens: 0,
        contextTokens: 1359,
        contextWindow: 500_000,
      })
      render(<ContextUsage />)
      fireEvent.click(screen.getByRole('button'))
      expect(screen.getByText('1.4k / 500.0k')).toBeTruthy()

      await act(async () => {
        useChatStore.getState().setPreferredProvider(provider)
      })

      expect(screen.queryByRole('button')).toBeNull()
      expect(screen.queryByText(/1\.4k/)).toBeNull()
      const project = useChatStore.getState().projectSessions[WIN_PATH]
      expect(project._activeSessionId).toBe(sid)
      expect(project._sessions[sid]).toMatchObject({
        sessionProvider: provider,
        messages: [],
        contextTokens: 0,
        contextWindow: null,
      })
    },
  )
})
