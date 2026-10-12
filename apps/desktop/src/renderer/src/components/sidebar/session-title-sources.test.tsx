/** @vitest-environment jsdom */

import { act, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { SESSION_TITLE_MAX_CHARS } from '@superone/shared/session-title'
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

function message(text: string, provider: 'claude' | 'codex' = 'codex'): ChatMessage {
  return { id: text, role: 'user', providerId: provider, status: 'complete', createdAt: '',
    content: [{ type: 'text', text }] }
}

function seed({ liveTitle = null, savedTitle, agentTitle, messages = [message(BACKING_PROMPT)], provider = 'codex', animateInitialTitle = false }: {
  liveTitle?: string | null; savedTitle?: string; agentTitle?: string; messages?: ChatMessage[]; provider?: 'claude' | 'codex'; animateInitialTitle?: boolean
}) {
  const project = createDefaultProjectState()
  project._activeSessionId = SID
  project._sessions[SID] = { ...createDefaultPerSessionState(), sessionProvider: provider,
    _title: liveTitle, _animateInitialTitle: animateInitialTitle, _historyHydrated: true, messages }
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
  Object.assign(window.environment, { sendSessionMessage: vi.fn().mockResolvedValue(null) })
})

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('session title sources across surfaces', () => {
  it.each(['claude', 'codex'] as const)('plays the sidebar entrance after the first %s send', async (provider) => {
    vi.useFakeTimers()
    seed({ messages: [], provider })
    vi.spyOn(window.environment, 'getSession').mockResolvedValue({ harnessId: provider })
    const send = vi.spyOn(window.environment, 'sendSessionMessage').mockResolvedValue({ sessionId: SID, title: '/release alpha' })
    await act(async () => { await useChatStore.getState().sendMessage('/release alpha') })
    expect(send).toHaveBeenCalledWith('local', expect.objectContaining({ sessionId: SID, text: '/release alpha' }))
    const { container } = render(<SessionRow folderPath={PROJECT}
      session={{ sessionId: SID, title: '/release alpha', lastActiveAt: '', messageCount: 1, provider }} {...callbacks} />)
    expect(container.querySelector('.animated-title-wrap')).toHaveAttribute('data-phase', 'in')
    expect(container.querySelector('.is-flip')).not.toBeNull()
    act(() => { vi.advanceTimersByTime(3000) })
    expect(container.querySelector('.animated-title-wrap')).toHaveAttribute('data-phase', 'idle')
  })

  it.each(['claude', 'codex'] as const)('animates a new %s first title once and shows it immediately on later mounts', (provider) => {
    vi.useFakeTimers()
    const text = 'First message with a long title '.repeat(15)
    const title = text.slice(0, SESSION_TITLE_MAX_CHARS)
    seed({ messages: [message(text, provider)], provider, animateInitialTitle: true })
    const row = <SessionRow folderPath={PROJECT}
      session={{ sessionId: SID, title, lastActiveAt: '', messageCount: 1, provider }} {...callbacks} />
    const { container, unmount } = render(<StrictMode>{row}</StrictMode>)
    expect(container.querySelector('.animated-title-inner')).toHaveTextContent(title)
    expect(container.querySelector('.animated-title-wrap')).toHaveAttribute('data-phase', 'in')
    expect(container.querySelector('.is-flip')).not.toBeNull()
    expect(useChatStore.getState().projectSessions[PROJECT]._sessions[SID]._animateInitialTitle).toBe(false)
    act(() => { seed({ messages: [message(text, provider)], savedTitle: 'Untitled', provider }) })
    act(() => { vi.advanceTimersByTime(100) })
    act(() => { seed({ messages: [message(text, provider)], liveTitle: title, savedTitle: title, provider }) })
    expect(container.querySelector('.animated-title-wrap')).toHaveAttribute('data-phase', 'in')
    act(() => { vi.advanceTimersByTime(13000) })
    expect(container.querySelector('.animated-title-wrap')).toHaveAttribute('data-phase', 'idle')
    unmount()
    const reopened = render(row)
    expect(reopened.container.querySelector('.animated-title-wrap')).toHaveAttribute('data-phase', 'idle')
  })

  it.each(['claude', 'codex'] as const)('keeps the first %s message visible when list metadata briefly replaces its title', (provider) => {
    vi.useFakeTimers()
    const title = '/release alpha'
    const messages = [message(title, provider)]
    seed({ messages: [], provider })
    const header = <div data-testid="header"><SessionTitleAnimated projectPath={PROJECT} sessionId={SID} /></div>
    const { rerender } = render(<div>{header}</div>)

    act(() => { seed({ messages, provider }) })
    // A sidebar row first mounts with the user message, while the existing header
    // is still animating away from New session.
    rerender(<div>{header}<div data-testid="sidebar"><SessionRow folderPath={PROJECT}
      session={{ sessionId: SID, title, lastActiveAt: '', messageCount: 1, provider }} {...callbacks} /></div></div>)
    expect(screen.getByTestId('sidebar').querySelector('.animated-title-wrap')).toHaveAttribute('data-phase', 'idle')

    act(() => { seed({ messages, savedTitle: 'Untitled', provider }) })
    act(() => { vi.advanceTimersByTime(100) })
    act(() => { seed({ messages, liveTitle: title, savedTitle: title, provider }) })
    act(() => { vi.advanceTimersByTime(3000) })

    for (const surface of ['header', 'sidebar']) {
      expect(screen.getByTestId(surface).querySelector('.animated-title-inner')).toHaveTextContent(title)
      expect(screen.getByTestId(surface).querySelector('.animated-title-wrap'), surface).toHaveAttribute('data-phase', 'idle')
    }

    act(() => { useChatStore.getState().handleAgentEvent({ type: 'session_title_changed', projectPath: PROJECT,
      sessionId: SID, title: 'Publish SuperOne Alpha', source: 'agent' }) })
    expect(screen.getByTestId('sidebar').querySelector('.animated-title-wrap')).toHaveAttribute('data-phase', 'out')
    act(() => { vi.advanceTimersByTime(3000) })
    for (const surface of ['header', 'sidebar']) {
      expect(screen.getByTestId(surface).querySelector('.animated-title-inner')).toHaveTextContent('Publish SuperOne Alpha')
      expect(screen.getByTestId(surface).querySelector('.animated-title-wrap')).toHaveAttribute('data-phase', 'idle')
    }
  })

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
