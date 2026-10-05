/** @vitest-environment jsdom */
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { SessionScopeProvider } from '@/stores/chat-store/session-scope'
import { useWidgetInputRequest, useWidgetInputs } from './use-widget-input-request'

const fixture = vi.hoisted(() => ({ messages: [] as ChatMessage[], open: vi.fn(), composerOpen: vi.fn(), composerAwait: vi.fn(), composerCancel: vi.fn() }))
vi.mock('@/stores/chat', () => {
  const state = () => ({ activeProject: '/other', projectSessions: { '/p': { _activeSessionId: 'other', _sessions: { owner: { messages: fixture.messages } } } } })
  const useChatStore = Object.assign((selector: (value: ReturnType<typeof state>) => unknown) => selector(state()), { getState: state })
  return { useChatStore }
})
const spec = { title: 'Review', requestedSchema: { type: 'object', properties: { notes: { type: 'string' } } } }
const wrapper = ({ children }: { children: ReactNode }) => <SessionScopeProvider value={{ projectPath: '/p', sessionId: 'owner' }}>{children}</SessionScopeProvider>

beforeEach(() => {
  fixture.messages = []
  fixture.open.mockReset().mockResolvedValue({ ok: true, requestId: 'opened' })
  fixture.composerOpen.mockReset().mockResolvedValue({ ok: true, requestId: 'form' })
  fixture.composerAwait.mockReset().mockResolvedValue({ status: 'submitted', values: { notes: 'answer' } })
  fixture.composerCancel.mockReset()
  Object.assign(window, { agent: { openWidgetInputRequest: fixture.open, composerOpen: fixture.composerOpen, composerAwait: fixture.composerAwait, composerCancel: fixture.composerCancel } })
})

it('uses the same captured message and pane for unified frontend completion', async () => {
  fixture.messages = [{ id: 'message', role: 'assistant', status: 'complete', content: [{ type: 'tool_use', toolUseId: 'widget', toolName: 'mcp__superone__widget_show', input: '{}', status: 'complete' }], createdAt: '', providerId: 'claude' }]
  const { result } = renderHook(() => useWidgetInputs('widget'), { wrapper })
  await expect(result.current.composerPorts.open({ viewId: 'view', localId: 'call', spec, output: 'caller' })).resolves.toEqual({ status: 'submitted', values: { notes: 'answer' } })
  expect(fixture.composerOpen).toHaveBeenCalledExactlyOnceWith({ source: { kind: 'widget', projectPath: '/p', sessionId: 'owner', messageId: 'message' }, viewId: 'view', localId: 'call', spec, output: 'caller' })
  expect(fixture.composerAwait).toHaveBeenCalledExactlyOnceWith('form')
  await result.current.composerPorts.release('view')
  expect(fixture.composerCancel).toHaveBeenCalledExactlyOnceWith('view')
})

it.each(['content', 'codex'])('opens a %s widget using its captured pane and message', async representation => {
  const message: ChatMessage = { id: 'message', role: 'assistant', status: 'complete', content: [], createdAt: '', providerId: representation === 'codex' ? 'codex' : 'claude' }
  if (representation === 'content') message.content = [{ type: 'tool_use', toolUseId: 'widget', toolName: 'mcp__superone__widget_show', input: '{}', status: 'complete' }]
  else message.metadata = { codex: { threadId: 'thread', usage: null, items: [{ type: 'mcp_tool_call', id: 'widget', server: 'superone', tool: 'widget_show', arguments: {}, status: 'completed' }] } }
  fixture.messages = [message]
  const { result } = renderHook(() => useWidgetInputRequest('widget'), { wrapper })
  await result.current(spec)
  expect(fixture.open).toHaveBeenCalledExactlyOnceWith({ projectPath: '/p', sessionId: 'owner', messageId: 'message', spec })
})

it('does not treat another Codex tool with the same item id as a widget', async () => {
  fixture.messages = [{ id: 'other', role: 'assistant', status: 'complete', providerId: 'codex', content: [], createdAt: '', metadata: { codex: { threadId: 't', usage: null,
    items: [{ type: 'mcp_tool_call', id: 'widget', server: 'superone', tool: 'read_manual', arguments: {}, status: 'completed' }],
  } } }]
  const { result } = renderHook(() => useWidgetInputRequest('widget'), { wrapper })
  await expect(result.current(spec)).rejects.toThrow('no longer in the session')
  expect(fixture.open).not.toHaveBeenCalled()
})
