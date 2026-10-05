/** @vitest-environment jsdom */

import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { DEFAULT_SESSION_TITLE, selectSessionTitle } from '@/lib/session-title'
import { MiniWindowHeader } from '@/components/MiniWindowApp'
import { collectAllActiveRows } from '@/components/chat/SessionSwitcherPopup'
import { SessionTitleAnimated } from './AnimatedSessionTitle'
import { SessionRow } from './SessionRow'

const PROJECT = '/voice'
const SID = 'voice-session'
const BACKING_PROMPT = 'You are the coding agent behind a voice conversation'
const callbacks = {
  onSwitchSession: vi.fn(), onPinSession: vi.fn(), onHideSession: vi.fn(),
  onRenameSession: vi.fn(), onDeleteSession: vi.fn(),
}

function message(text: string): ChatMessage {
  return { id: text, role: 'user', providerId: 'codex', status: 'complete', createdAt: '',
    content: [{ type: 'text', text }] }
}

function seed({ liveTitle = null, savedTitle, agentTitle, messages = [message(BACKING_PROMPT)] }: {
  liveTitle?: string | null; savedTitle?: string; agentTitle?: string; messages?: ChatMessage[]
}) {
  const project = createDefaultProjectState()
  project._activeSessionId = SID
  project._sessions[SID] = { ...createDefaultPerSessionState(), sessionProvider: 'codex',
    _title: liveTitle, _historyHydrated: true, messages }
  project.sessions = savedTitle ? [{ sessionId: SID, title: savedTitle, lastActiveAt: '', messageCount: 1 }] : []
  useChatStore.setState({ activeProject: PROJECT, projectSessions: { [PROJECT]: project },
    agentTitles: agentTitle ? { [SID]: agentTitle } : {} })
}

function renderTitles(sidebarTitle: string) {
  return render(<>
    <div data-testid="header"><SessionTitleAnimated projectPath={PROJECT} sessionId={SID} /></div>
    <div data-testid="sidebar"><SessionRow folderPath={PROJECT}
      session={{ sessionId: SID, title: sidebarTitle, lastActiveAt: '', messageCount: 1, provider: 'codex' }}
      animateTitle={false} {...callbacks} /></div>
    <div data-testid="mini"><MiniWindowHeader initialTitle={sidebarTitle} /></div>
  </>)
}

function expectTitles(title: string) {
  expect(screen.getByTestId('header').querySelector('.animated-title-inner')).toHaveTextContent(title)
  expect(screen.getByTestId('sidebar').querySelector('.session-row-title')).toHaveTextContent(title)
  expect(screen.getByTestId('mini').querySelector('.animated-title-inner')).toHaveTextContent(title)
  const state = useChatStore.getState()
  expect(collectAllActiveRows({ projectSessions: state.projectSessions, agentTitles: state.agentTitles,
    remoteSessions: {}, activeProject: PROJECT, previousFocusedSession: null })[0].title).toBe(title)
}

beforeEach(() => {
  useAppStore.setState({ currentFolder: PROJECT, tmpFolder: null })
})

afterEach(() => vi.useRealTimers())

describe('session title sources across surfaces', () => {
  it('uses the saved voice title everywhere while the per-session title is missing', () => {
    seed({ savedTitle: 'Plan the release' })
    renderTitles('Plan the release')
    expectTitles('Plan the release')
  })

  it('uses a restored live title ahead of older list and mini-window titles', () => {
    seed({ liveTitle: 'Restored voice title', savedTitle: 'Older list title' })
    renderTitles('Older list title')
    expectTitles('Restored voice title')
  })

  it('updates every surface when a rename arrives after frontend restore', () => {
    vi.useFakeTimers()
    seed({ liveTitle: 'Restored voice title', savedTitle: 'Older list title' })
    renderTitles('Older list title')
    act(() => {
      useChatStore.getState().handleAgentEvent({ type: 'session_title_changed', projectPath: PROJECT,
        sessionId: SID, title: 'New voice title', source: 'user' })
      vi.advanceTimersByTime(2000)
    })
    // Flush the title animation scheduled by the store update's React effect.
    act(() => { vi.advanceTimersByTime(2000) })
    expectTitles('New voice title')
  })

  it('uses the same first meaningful user message when the session has no saved title', () => {
    seed({ messages: [message('  '), message('  First spoken request  ')] })
    renderTitles('First spoken request')
    expectTitles('First spoken request')
  })

  it('uses the same empty-session title everywhere', () => {
    seed({ messages: [] })
    renderTitles(DEFAULT_SESSION_TITLE)
    expectTitles(DEFAULT_SESSION_TITLE)
  })

  it('looks up titles in the requested project rather than the active project', () => {
    seed({ savedTitle: 'Voice project title' })
    const other = createDefaultProjectState()
    other._sessions[SID] = { ...createDefaultPerSessionState(), _title: 'Other project title' }
    useChatStore.setState((state) => ({ activeProject: '/other', projectSessions: {
      ...state.projectSessions, '/other': other,
    } }))
    expect(selectSessionTitle(useChatStore.getState(), PROJECT, SID)).toBe('Voice project title')
    expect(selectSessionTitle(useChatStore.getState(), '/other', SID)).toBe('Other project title')
  })
})
