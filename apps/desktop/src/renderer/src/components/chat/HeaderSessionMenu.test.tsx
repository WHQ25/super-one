/** @vitest-environment jsdom */

import { render, act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach } from 'vitest'
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

  it('renders nothing for a freshly created session with no messages yet', () => {
    seedProject({ active: 'draft-empty', sessions: [], messages: [] })
    const { container } = render(<HeaderSessionMenu sessionId="draft-empty" folderPath={FOLDER} />)
    expect(trigger(container)).toBeNull()
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
  it('drops Hide and Add to Chat and converts this window instead of opening a new one', async () => {
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
    expect(screen.queryByRole('menuitem', { name: 'Hide Session' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Add to Chat' })).toBeNull()
    // Still the shared actions the sidebar row has.
    expect(screen.getByRole('menuitem', { name: 'Rename Session' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Pin Session' })).toBeInTheDocument()
  })
})
