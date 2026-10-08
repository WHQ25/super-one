import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ChatMessage, SendMessageRequest } from '@superone/shared/agent-types'
import { Session } from './session'
import type { SessionBackend } from './types'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))

const doneAt = '2026-10-08T05:00:00.000Z'

function fixture(harnessId: 'claude' | 'codex') {
  let emit!: (event: AgentEvent) => void
  const backend = {
    kind: harnessId, start: vi.fn(async () => {}), send: vi.fn(async (_request: SendMessageRequest) => {}),
    onEvent: (listener: typeof emit) => { emit = listener; return () => {} },
    onProviderSessionId: () => () => {}, onPermissionModeApplied: () => () => {},
  }
  const assistant: ChatMessage = { id: 'a1', role: 'assistant', status: 'streaming', content: [], createdAt: '2026-10-08T04:59:00.000Z', providerId: harnessId }
  const session = new Session({ id: 'session', projectPath: '/project', cwd: '/project',
    providerId: harnessId, harnessId, providerConfig: {}, backend: backend as unknown as SessionBackend,
    initialMessages: [assistant], onStateChange: vi.fn() })
  const out: AgentEvent[] = []
  session.on((event) => out.push(event))
  return { session, out, emit: (event: AgentEvent) => emit(event) }
}

describe('Session turn completion time', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(doneAt)) })
  afterEach(() => { vi.useRealTimers() })

  it.each<[string, 'claude' | 'codex', AgentEvent]>([
    ['complete', 'claude', { type: 'message_complete', messageId: 'a1' }],
    ['interrupt', 'claude', { type: 'message_interrupted', messageId: 'a1' }],
    ['error', 'claude', { type: 'message_error', messageId: 'a1', error: 'boom' }],
    ['Codex complete', 'codex', { type: 'message_complete', messageId: 'a1', metadata: { codex: { finalResponse: 'done', items: [], threadId: 't', usage: null } } as never }],
    ['Codex interrupt', 'codex', { type: 'message_interrupted', messageId: 'a1' }],
    ['Codex error', 'codex', { type: 'message_error', messageId: 'a1', error: 'boom' }],
  ])('stamps a %s on the outbound event and the stored message', (_label, harnessId, event) => {
    const { session, out, emit } = fixture(harnessId)
    emit(event)
    expect((out.find((e) => e.type === event.type) as { metadata?: { completedAt?: string } }).metadata?.completedAt).toBe(doneAt)
    expect(session.snapshot.messages.find((m) => m.id === 'a1')?.metadata?.completedAt).toBe(doneAt)
  })
})
