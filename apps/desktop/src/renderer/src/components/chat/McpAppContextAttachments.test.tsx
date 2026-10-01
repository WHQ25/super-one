/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { McpAppContextAttachments } from './McpAppContextAttachments'

const state = vi.hoisted(() => ({ scope: { projectPath: '/side-project', sessionId: 'side-session' },
  messages: [{ id: 'message', metadata: { codex: { items: [{ app: { appInstanceId: 'view', binding: { server: 'CAD' }, resourceUri: 'ui://view', modelContext: { updateId: 'revision', content: [{ type: 'text', text: 'Part details', _meta: { 'openai/title': 'Dial' } }], source: { appInstanceId: 'view', server: 'CAD' } } } }] } } }] }))
vi.mock('@/stores/chat', () => ({ useActiveSession: (select: (value: unknown) => unknown) => select({ messages: state.messages }), useSessionScope: () => state.scope,
  useChatStore: (select: (value: unknown) => unknown) => select({ activeProject: '/main-project', projectSessions: { '/main-project': { _activeSessionId: 'main-session' } } }) }))
vi.mock('@/hooks/use-is-dark', () => ({ useIsDark: () => false }))
afterEach(cleanup)

describe('composer context host wiring', () => {
  it('removes through the pane source route, with a revision and without a live document', async () => {
    const request = vi.fn(async () => ({ ok: true, value: null }))
    Object.defineProperty(window, 'environment', { configurable: true, value: { mcpAppRequest: request } })
    render(<McpAppContextAttachments />)
    fireEvent.click(screen.getByRole('button', { name: /Remove Context: Dial/ }))
    await waitFor(() => expect(request).toHaveBeenCalledOnce())
    expect(request).toHaveBeenCalledWith('/side-project', 'side-session', { operation: 'removeModelContext', appInstanceId: 'view', messageId: 'message', updateId: 'revision', blockIndex: 0 })
  })
  it('keeps the attachment and exposes a host refusal', async () => {
    Object.defineProperty(window, 'environment', { configurable: true, value: { mcpAppRequest: vi.fn(async () => ({ ok: false, error: { code: 'not_connected', message: 'Offline' } })) } })
    render(<McpAppContextAttachments />)
    fireEvent.click(screen.getByRole('button', { name: /Remove Context: Dial/ }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Offline'))
    expect(screen.getByRole('button', { name: 'Dial' })).toBeTruthy()
  })
})
