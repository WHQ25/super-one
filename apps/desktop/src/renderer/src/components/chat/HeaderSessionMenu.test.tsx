/** @vitest-environment jsdom */

import { render, act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach } from 'vitest'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { HeaderSessionMenu } from './HeaderSessionMenu'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import type { ChatMessage, SessionHistoryEntry } from '@superone/shared/agent-types'

const FOLDER = '/project'

function userMessage(): ChatMessage {
  return { id: 'm1', role: 'user', content: [{ type: 'text', text: 'hi' }] } as ChatMessage
}

function seedProject(input: { active: string; sessions?: SessionHistoryEntry[]; live?: boolean; messages?: ChatMessage[] }) {
  const project = createDefaultProjectState()
  project._activeSessionId = input.active
  if (input.live !== false) {
    project._sessions = {
      [input.active]: { ...createDefaultPerSessionState(), cwd: FOLDER, _title: 'Live Title', messages: input.messages ?? [userMessage()] },
    }
  }
  project.sessions = input.sessions ?? []
  act(() => {
    useChatStore.setState({ projectSessions: { [FOLDER]: project }, activeProject: FOLDER })
  })
}

function trigger(container: HTMLElement) {
  return container.querySelector('[aria-label="Session actions"]')
}

describe('HeaderSessionMenu data source', () => {
  beforeEach(() => {
    useChatStore.setState({ projectSessions: {}, activeProject: null })
  })

  it('renders the menu trigger once an in-memory session has a message but is absent from the persisted list', () => {
    seedProject({ active: 'draft-1', sessions: [] })
    const { container } = render(<HeaderSessionMenu sessionId="draft-1" folderPath={FOLDER} />)
    expect(trigger(container)).not.toBeNull()
  })

  it('renders the menu trigger when the session exists in the persisted list', () => {
    const persisted: SessionHistoryEntry = {
      sessionId: 'saved-1',
      title: 'Saved',
      lastActiveAt: '2026-01-01',
      messageCount: 3,
      isPinned: true,
    }
    seedProject({ active: 'saved-1', sessions: [persisted] })
    const { container } = render(<HeaderSessionMenu sessionId="saved-1" folderPath={FOLDER} />)
    expect(trigger(container)).not.toBeNull()
  })

  it('renders nothing when the session is in neither memory nor the persisted list', () => {
    seedProject({ active: 'other', sessions: [], live: false })
    const { container } = render(<HeaderSessionMenu sessionId="ghost" folderPath={FOLDER} />)
    expect(trigger(container)).toBeNull()
  })
})

describe('HeaderSessionMenu item set', () => {
  beforeEach(() => {
    useChatStore.setState({ projectSessions: {}, activeProject: null })
  })

  // The header menu acts on the session already open, so it deliberately carries a
  // smaller set than the sidebar row menu it shares a builder with.
  it('offers Settle, drops Add to Chat, and converts this window instead of opening a new one', async () => {
    const persisted: SessionHistoryEntry = {
      sessionId: 'saved-1',
      title: 'Saved',
      lastActiveAt: '2026-01-01',
      messageCount: 3,
    }
    seedProject({ active: 'saved-1', sessions: [persisted] })
    const user = userEvent.setup()
    const { container } = render(<HeaderSessionMenu sessionId="saved-1" folderPath={FOLDER} />)

    await user.click(trigger(container) as HTMLElement)

    expect(await screen.findByRole('menuitem', { name: 'Convert to Mini Window' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Open in Mini Window' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Settle' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Add to Chat' })).toBeNull()
    // Still the shared actions the sidebar row has.
    expect(screen.getByRole('menuitem', { name: 'Rename Session' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Pin Session' })).toBeInTheDocument()
  })

  it('hides pin and offers unsettle when the open session is settled', async () => {
    const persisted: SessionHistoryEntry = {
      sessionId: 'saved-1',
      title: 'Saved',
      lastActiveAt: '2026-01-01',
      messageCount: 3,
      isSettled: true,
      isPinned: true,
    }
    seedProject({ active: 'saved-1', sessions: [persisted] })
    const user = userEvent.setup()
    const { container } = render(<HeaderSessionMenu sessionId="saved-1" folderPath={FOLDER} />)

    await user.click(trigger(container) as HTMLElement)

    expect(await screen.findByRole('menuitem', { name: 'Unsettle' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Pin Session' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Unpin Session' })).toBeNull()
  })

  it('hides settle while a spawn child is still running', async () => {
    const persisted: SessionHistoryEntry = {
      sessionId: 'saved-1',
      title: 'Saved',
      lastActiveAt: '2026-01-01',
      messageCount: 3,
    }
    seedProject({ active: 'saved-1', sessions: [persisted] })
    act(() => {
      const project = useChatStore.getState().projectSessions[FOLDER]!
      const child = createDefaultPerSessionState()
      child.status = 'streaming'
      child._parentSessionId = 'saved-1'
      project._sessions.child = child
      useChatStore.setState({ projectSessions: { [FOLDER]: { ...project } } })
    })
    const user = userEvent.setup()
    const { container } = render(<HeaderSessionMenu sessionId="saved-1" folderPath={FOLDER} />)

    await user.click(trigger(container) as HTMLElement)

    expect(await screen.findByRole('menuitem', { name: 'Pin Session' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Settle' })).toBeNull()
  })

  it('hides settle while the open turn is streaming', async () => {
    const persisted: SessionHistoryEntry = {
      sessionId: 'saved-1',
      title: 'Saved',
      lastActiveAt: '2026-01-01',
      messageCount: 3,
    }
    seedProject({ active: 'saved-1', sessions: [persisted] })
    act(() => {
      const project = useChatStore.getState().projectSessions[FOLDER]
      const live = project._sessions['saved-1']
      if (live) live.status = 'streaming'
      useChatStore.setState({ projectSessions: { [FOLDER]: { ...project } } })
    })
    const user = userEvent.setup()
    const { container } = render(<HeaderSessionMenu sessionId="saved-1" folderPath={FOLDER} />)

    await user.click(trigger(container) as HTMLElement)

    expect(await screen.findByRole('menuitem', { name: 'Pin Session' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Settle' })).toBeNull()
  })

  it('offers only the chat form entries on a new session with no messages yet', async () => {
    seedProject({ active: 'draft-empty', sessions: [], messages: [] })
    act(() => { useActivityPanelStore.setState({ showPanel: false, maximized: false, chatFloating: false }) })
    const user = userEvent.setup()
    const { container } = render(<HeaderSessionMenu sessionId="draft-empty" folderPath={FOLDER} />)

    await user.click(trigger(container) as HTMLElement)

    const items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent)
    expect(items).toEqual(['Float Chat', 'Convert to Mini Window'])
  })

  it('floats the chat from beside the mini window entry, and docks it back', async () => {
    seedProject({ active: 'saved-1' })
    act(() => { useActivityPanelStore.setState({ showPanel: false, maximized: false, chatFloating: false }) })
    const user = userEvent.setup()
    const { container } = render(<HeaderSessionMenu sessionId="saved-1" folderPath={FOLDER} />)

    await user.click(trigger(container) as HTMLElement)
    const items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent)
    expect(items.indexOf('Float Chat')).toBe(items.indexOf('Convert to Mini Window') - 1)
    await user.click(screen.getByRole('menuitem', { name: 'Float Chat' }))

    expect(useActivityPanelStore.getState()).toMatchObject({ showPanel: true, chatFloating: true, maximized: false })
    expect(useChatStore.getState().isOpen).toBe(true)

    await user.click(trigger(container) as HTMLElement)
    await user.click(await screen.findByRole('menuitem', { name: 'Dock Chat' }))
    expect(useActivityPanelStore.getState().chatFloating).toBe(false)
  })
})
