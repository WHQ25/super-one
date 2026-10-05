/** @vitest-environment jsdom */

import { createRef } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { ChatContent } from './ChatContent'

const PROJECT = '/tmp/session-switch-regression'
const initialChat = useChatStore.getState()
const initialApp = useAppStore.getState()
const initialSettings = useSettingsStore.getState()

// jsdom has no FontFaceSet; the production editor waits for fonts before measuring chips.
Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } })
Object.assign(window.app, {
  getAppSettings: vi.fn(async () => ({ agentPreference: { claude: { drawModInterfaces: false } } })),
  connectClaude: vi.fn(async () => ({
    models: [], account: {}, slashCommands: [], skills: [], commands: [], agents: [], outputStyles: [],
  })),
  collaborationMailbox: { list: vi.fn(async () => []), onChanged: vi.fn(() => () => {}) },
  listPlatforms: vi.fn(async () => []),
  listCredentials: vi.fn(async () => []),
  listBindings: vi.fn(async () => []),
  claudeListAccounts: vi.fn(async () => []),
})

function messages(sessionId: string): ChatMessage[] {
  return [{
    id: `${sessionId}-message`,
    role: 'user',
    status: 'complete',
    providerId: 'local',
    createdAt: '2026-10-05T00:00:00.000Z',
    content: [{ type: 'text', text: `Conversation ${sessionId}` }],
  }]
}

afterEach(() => {
  cleanup()
  useChatStore.setState(initialChat, true)
  useAppStore.setState(initialApp, true)
  useSettingsStore.setState(initialSettings, true)
  vi.restoreAllMocks()
})

describe('chat transcript session switching', () => {
  it('replaces the outgoing transcript on repeated switches while preserving each session history', async () => {
    const histories = { first: messages('first'), second: messages('second'), third: messages('third') }
    useAppStore.setState({ harnessCatalog: null })
    useChatStore.setState({
      activeProject: PROJECT,
      projectSessions: {
        [PROJECT]: {
          ...createDefaultProjectState(),
          _activeSessionId: 'first',
          _sessions: Object.fromEntries(Object.entries(histories).map(([id, history]) => [id, {
            ...createDefaultPerSessionState(),
            cwd: PROJECT,
            sessionProvider: 'claude',
            messages: history,
          }])),
        },
      },
    })
    const errors = vi.spyOn(console, 'error')
    const { container } = render(<ChatContent scrollViewportRef={createRef<HTMLDivElement>()} foreground={false} />)

    for (const sessionId of ['second', 'third', 'first', 'second']) {
      await act(async () => { await useChatStore.getState().switchSession(sessionId) })

      expect(container.querySelectorAll('[data-transcript-frame]')).toHaveLength(1)
      expect(container.querySelectorAll('[data-message-id]')).toHaveLength(1)
      expect(screen.getAllByTestId('composer-slot')).toHaveLength(1)
      expect(screen.getByText(`Conversation ${sessionId}`)).toBeInTheDocument()
      for (const other of Object.keys(histories).filter(id => id !== sessionId)) {
        expect(screen.queryByText(`Conversation ${other}`)).toBeNull()
      }
    }

    expect(errors.mock.calls.filter(args => args.some(value => /same key/i.test(String(value))))).toEqual([])
    const sessions = useChatStore.getState().projectSessions[PROJECT]._sessions
    for (const [id, history] of Object.entries(histories)) expect(sessions[id].messages).toEqual(history)
  })
})
